const request = require('supertest');
const { loadEnvironment } = require('../../../../infrastructure/config/environment');
const { createApp } = require('../../../../app');
const { buildPaymentDeps } = require('../../../../container');
const { createMemoryStore } = require('../../../../infrastructure/persistence/memory-store');
const {
  notification,
  SERVER_KEY,
  ORDER_ID,
  BOOKING_ID
} = require('../../../../application/webhook/__tests__/webhook-test-harness');

const START_TIME = new Date('2026-11-14T03:40:00.000Z');

/**
 * Builds the app with a stubbed Midtrans + core client (no network, no DB).
 *
 * @param {object} [options] - Harness options.
 * @param {Function} [options.getStatusImpl] - Stub for Get Status.
 * @param {Function} [options.coreImpl] - Stub for core notifyPaymentResult.
 * @returns {Promise<object>} { app, store, midtransClient, coreClient }.
 */
async function buildTestApp({ getStatusImpl, coreImpl, webhookUseCase } = {}) {
  const config = loadEnvironment({ MIDTRANS_SERVER_KEY: SERVER_KEY });
  const store = createMemoryStore();
  await store.createPaymentOrder({
    orderId: ORDER_ID,
    bookingId: BOOKING_ID,
    attempt: 1,
    grossAmount: 3015000,
    snapStartTime: START_TIME
  });
  const midtransClient = {
    createSnap: jest.fn(),
    getStatus: jest.fn(async (orderId) => {
      if (getStatusImpl) return getStatusImpl(orderId);
      return {
        order_id: orderId,
        transaction_id: 'tx-1',
        transaction_status: 'settlement',
        fraud_status: 'accept',
        payment_type: 'qris',
        gross_amount: '3015000.00',
        status_code: '200',
        currency: 'IDR'
      };
    }),
    expire: jest.fn()
  };
  const coreClient = {
    notifyPaymentResult: jest.fn(async () => {
      if (coreImpl) return coreImpl();
      return { handled: true, late: false, duplicate: false, reason: null };
    })
  };
  const deps = buildPaymentDeps(config, {
    store,
    midtransClient,
    coreClient,
    ...(webhookUseCase ? { webhookUseCase } : {})
  });
  const app = createApp({ config, deps });
  return { app, store, midtransClient, coreClient };
}

describe('POST /v1/payment/webhooks/midtrans', () => {
  it('accepts a valid settlement notification (200) and notifies core', async () => {
    const { app, coreClient, midtransClient } = await buildTestApp();
    const response = await request(app).post('/v1/payment/webhooks/midtrans').send(notification());
    expect(response.status).toBe(200);
    expect(midtransClient.getStatus).toHaveBeenCalledWith(ORDER_ID);
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });

  it('answers 200 for an invalid signature (no Get Status, no core call)', async () => {
    const { app, coreClient, midtransClient } = await buildTestApp();
    const body = notification();
    body.signature_key = '0'.repeat(128);
    const response = await request(app).post('/v1/payment/webhooks/midtrans').send(body);
    expect(response.status).toBe(200);
    expect(midtransClient.getStatus).not.toHaveBeenCalled();
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
  });

  it('answers 200 for a duplicate notification', async () => {
    const { app, coreClient } = await buildTestApp();
    await request(app).post('/v1/payment/webhooks/midtrans').send(notification());
    const second = await request(app).post('/v1/payment/webhooks/midtrans').send(notification());
    expect(second.status).toBe(200);
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });

  it('answers 200 for malformed JSON (Q45: invalid -> 200, no state change)', async () => {
    const { app, coreClient } = await buildTestApp();
    const response = await request(app)
      .post('/v1/payment/webhooks/midtrans')
      .set('Content-Type', 'application/json')
      .send('{"order_id": ');
    expect(response.status).toBe(200);
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
  });

  it('answers 200 for an oversize body (over the 64 KB webhook limit)', async () => {
    const { app, coreClient } = await buildTestApp();
    const body = notification();
    body.padding = 'x'.repeat(70000);
    const response = await request(app).post('/v1/payment/webhooks/midtrans').send(body);
    expect(response.status).toBe(200);
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
  });

  it('answers 500 when Get Status cannot confirm (Midtrans retries once)', async () => {
    const { app, midtransClient } = await buildTestApp();
    midtransClient.getStatus.mockRejectedValue(
      Object.assign(new Error('Midtrans 500'), { name: 'MidtransError', status: 500 })
    );
    const response = await request(app).post('/v1/payment/webhooks/midtrans').send(notification());
    expect(response.status).toBe(500);
  });

  it('answers 500 when the core callback fails after retries', async () => {
    const { app, coreClient } = await buildTestApp({
      coreImpl: async () => {
        throw new Error('core unreachable');
      }
    });
    const response = await request(app).post('/v1/payment/webhooks/midtrans').send(notification());
    expect(response.status).toBe(500);
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(3);
  });

  it('answers 500 when the webhook service throws unexpectedly', async () => {
    const { app } = await buildTestApp({
      webhookUseCase: {
        processNotification: async () => {
          throw new Error('boom');
        }
      }
    });
    const response = await request(app).post('/v1/payment/webhooks/midtrans').send(notification());
    expect(response.status).toBe(500);
  });

  it('unknown routes still 404 (error passes through the webhook error handler)', async () => {
    const { app } = await buildTestApp();
    const response = await request(app).get('/nope');
    expect(response.status).toBe(404);
  });

  it('rejects non-POST methods (405/404, POST-only per Q45)', async () => {
    const { app } = await buildTestApp();
    const response = await request(app).get('/v1/payment/webhooks/midtrans');
    expect([404, 405]).toContain(response.status);
  });

  it('old path /v1/webhooks/midtrans now 404s (moved to /v1/payment/*)', async () => {
    const { app } = await buildTestApp();
    const response = await request(app).post('/v1/webhooks/midtrans').send(notification());
    expect(response.status).toBe(404);
  });

  it('health endpoints still work', async () => {
    const { app } = await buildTestApp();
    const ping = await request(app).get('/sys/ping');
    expect(ping.status).toBe(200);
    expect(ping.text).toBe('ok');
  });
});
