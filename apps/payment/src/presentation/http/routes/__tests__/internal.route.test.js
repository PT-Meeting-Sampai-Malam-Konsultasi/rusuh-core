const request = require('supertest');
const { loadEnvironment } = require('../../../../infrastructure/config/environment');
const { createApp } = require('../../../../app');
const { buildPaymentDeps } = require('../../../../container');
const { createMemoryStore } = require('../../../../infrastructure/persistence/memory-store');
const { MidtransError } = require('../../../../domain/ports/midtrans');

const KEY = 'internal-test-key';
const START = '2026-11-14T03:40:00.000Z';
const SNAP_BODY = {
  bookingId: 'bk_01',
  attempt: 1,
  orderId: 'bk_01-1',
  grossAmount: 3015000,
  itemDetails: [{ id: 'cat', price: 3015000, quantity: 1, name: 'Festival B' }],
  snapStartTime: START
};

function buildApp({ serviceCredential = KEY, midtrans = true, midtransOverrides = {} } = {}) {
  const config = loadEnvironment({
    MIDTRANS_SERVER_KEY: midtrans ? 'sk-test' : '',
    CORE_SERVICE_CREDENTIAL: serviceCredential
  });
  const store = createMemoryStore();
  const midtransClient = midtrans
    ? {
        createSnap: jest.fn(async () => ({ token: 'tok-1', redirectUrl: 'https://snap/tok-1' })),
        getStatus: jest.fn(async (orderId) => ({
          order_id: orderId,
          transaction_id: 'tx-1',
          transaction_status: 'settlement',
          payment_type: 'qris',
          gross_amount: '3015000.00',
          status_code: '200'
        })),
        expire: jest.fn(async () => ({})),
        ...midtransOverrides
      }
    : undefined;
  const deps = buildPaymentDeps(config, {
    store,
    ...(midtransClient ? { midtransClient } : {}),
    logger: { addTags: () => ({}), addData: () => ({}) }
  });
  return { app: createApp({ config, deps }), store, midtransClient };
}

describe('internal routes: service key', () => {
  const routes = [
    ['post', '/v1/internal/payments/snap'],
    ['get', '/v1/internal/payments/orders/bk_01-1/status'],
    ['post', '/v1/internal/payments/orders/bk_01-1/expire']
  ];

  it.each(routes)('%s %s rejects a missing key with 401', async (method, path) => {
    const { app, midtransClient } = buildApp();
    const response = await request(app)[method](path).send(SNAP_BODY);
    expect(response.status).toBe(401);
    expect(midtransClient.createSnap).not.toHaveBeenCalled();
    expect(midtransClient.getStatus).not.toHaveBeenCalled();
    expect(midtransClient.expire).not.toHaveBeenCalled();
  });

  it.each(routes)('%s %s rejects a wrong key with 401', async (method, path) => {
    const { app } = buildApp();
    const response = await request(app)[method](path).set('x-service-key', 'nope').send(SNAP_BODY);
    expect(response.status).toBe(401);
  });

  it('rejects a key of a different length without throwing', async () => {
    const { app } = buildApp();
    const longer = await request(app).post(routes[0][1]).set('x-service-key', `${KEY}-extra`).send(SNAP_BODY);
    const shorter = await request(app).post(routes[0][1]).set('x-service-key', KEY.slice(0, 3)).send(SNAP_BODY);
    expect(longer.status).toBe(401);
    expect(shorter.status).toBe(401);
  });

  it('rejects an empty key and a repeated header (array) with 401', async () => {
    const { app } = buildApp();
    const empty = await request(app).post(routes[0][1]).set('x-service-key', '').send(SNAP_BODY);
    expect(empty.status).toBe(401);
    const repeated = await request(app).post(routes[0][1]).set('x-service-key', [KEY, KEY]).send(SNAP_BODY);
    expect(repeated.status).toBe(401);
  });

  it('fails closed when no secret is configured, even if a key is sent', async () => {
    const { app } = buildApp({ serviceCredential: '' });
    const response = await request(app).post(routes[0][1]).set('x-service-key', KEY).send(SNAP_BODY);
    expect(response.status).toBe(401);
    const blank = await request(app).post(routes[0][1]).set('x-service-key', '').send(SNAP_BODY);
    expect(blank.status).toBe(401);
  });

  it('never accepts an account JWT in place of the key', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post(routes[0][1])
      .set('Authorization', 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig')
      .send(SNAP_BODY);
    expect(response.status).toBe(401);
  });

  it('does not echo the credential in the response', async () => {
    const { app } = buildApp();
    const response = await request(app).post(routes[0][1]).set('x-service-key', 'leak-me-not').send(SNAP_BODY);
    expect(JSON.stringify(response.body)).not.toContain('leak-me-not');
    expect(JSON.stringify(response.body)).not.toContain(KEY);
  });
});

describe('POST /v1/internal/payments/snap', () => {
  it('creates the snap and returns the contract fields as plain JSON', async () => {
    const { app, store, midtransClient } = buildApp();
    const response = await request(app).post('/v1/internal/payments/snap').set('x-service-key', KEY).send(SNAP_BODY);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      orderId: 'bk_01-1',
      attempt: 1,
      snapToken: 'tok-1',
      redirectUrl: 'https://snap/tok-1'
    });
    expect(response.body.gatewayExpiresAt).toBe('2026-11-14T03:50:00.000Z');
    expect((await store.getPaymentOrder('bk_01-1')).status).toBe('pending');
    expect(midtransClient.createSnap).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for a mismatching orderId and writes no row', async () => {
    const { app, store } = buildApp();
    const response = await request(app)
      .post('/v1/internal/payments/snap')
      .set('x-service-key', KEY)
      .send({ ...SNAP_BODY, attempt: 2 });
    expect(response.status).toBe(400);
    expect(await store.getPaymentOrdersByBooking('bk_01')).toHaveLength(0);
  });

  it('returns 400 for an invalid body and 409 for a duplicate order', async () => {
    const { app } = buildApp();
    const invalid = await request(app)
      .post('/v1/internal/payments/snap')
      .set('x-service-key', KEY)
      .send({ ...SNAP_BODY, grossAmount: -1 });
    expect(invalid.status).toBe(400);
    await request(app).post('/v1/internal/payments/snap').set('x-service-key', KEY).send(SNAP_BODY);
    const duplicate = await request(app).post('/v1/internal/payments/snap').set('x-service-key', KEY).send(SNAP_BODY);
    expect(duplicate.status).toBe(409);
  });

  it('keeps the original snapStartTime on attempt 2', async () => {
    const { app, store } = buildApp();
    await request(app).post('/v1/internal/payments/snap').set('x-service-key', KEY).send(SNAP_BODY);
    const second = await request(app)
      .post('/v1/internal/payments/snap')
      .set('x-service-key', KEY)
      .send({ ...SNAP_BODY, attempt: 2, orderId: 'bk_01-2', snapStartTime: '2026-11-14T03:45:00.000Z' });
    expect(second.status).toBe(200);
    expect((await store.getPaymentOrder('bk_01-2')).snapStartTime).toEqual(new Date(START));
  });

  it('answers 503 when Midtrans is not configured, with no internal detail', async () => {
    const { app } = buildApp({ midtrans: false });
    const response = await request(app).post('/v1/internal/payments/snap').set('x-service-key', KEY).send(SNAP_BODY);
    expect(response.status).toBe(503);
  });
});

describe('GET /v1/internal/payments/orders/:orderId/status', () => {
  it('maps transactionStatus to status', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/v1/internal/payments/orders/bk_01-1/status').set('x-service-key', KEY);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'settlement',
      grossAmount: '3015000.00',
      transactionId: 'tx-1',
      paymentType: 'qris'
    });
  });

  it('decodes an orderId with special characters', async () => {
    const { app, midtransClient } = buildApp();
    await request(app).get('/v1/internal/payments/orders/bk%2F1-1/status').set('x-service-key', KEY);
    expect(midtransClient.getStatus).toHaveBeenCalledWith('bk/1-1');
  });

  it('answers 404 when Midtrans has no transaction yet', async () => {
    const { app } = buildApp({
      midtransOverrides: {
        getStatus: jest.fn(async () => {
          throw new MidtransError('not found', 404);
        })
      }
    });
    const response = await request(app).get('/v1/internal/payments/orders/bk_01-1/status').set('x-service-key', KEY);
    expect(response.status).toBe(404);
  });

  it('answers 502 when Get Status stays unconfirmed', async () => {
    const { app } = buildApp({
      midtransOverrides: {
        getStatus: jest.fn(async () => {
          throw new MidtransError('boom', 500);
        })
      }
    });
    const response = await request(app).get('/v1/internal/payments/orders/bk_01-1/status').set('x-service-key', KEY);
    expect(response.status).toBe(502);
  }, 10000);

  it('answers 503 when Midtrans is not configured', async () => {
    const { app } = buildApp({ midtrans: false });
    const response = await request(app).get('/v1/internal/payments/orders/bk_01-1/status').set('x-service-key', KEY);
    expect(response.status).toBe(503);
  });
});

describe('POST /v1/internal/payments/orders/:orderId/expire', () => {
  it('answers 200 on success', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/v1/internal/payments/orders/bk_01-1/expire').set('x-service-key', KEY);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, orderId: 'bk_01-1' });
  });

  it('answers 412 when already expired or settled', async () => {
    const { app } = buildApp({
      midtransOverrides: {
        expire: jest.fn(async () => {
          throw new MidtransError('gone', 412);
        })
      }
    });
    const response = await request(app).post('/v1/internal/payments/orders/bk_01-1/expire').set('x-service-key', KEY);
    expect(response.status).toBe(412);
  });

  it('answers 502 when expiring fails', async () => {
    const { app } = buildApp({
      midtransOverrides: {
        expire: jest.fn(async () => {
          throw new MidtransError('boom', 500);
        })
      }
    });
    const response = await request(app).post('/v1/internal/payments/orders/bk_01-1/expire').set('x-service-key', KEY);
    expect(response.status).toBe(502);
  });

  it('answers 503 when Midtrans is not configured', async () => {
    const { app } = buildApp({ midtrans: false });
    const response = await request(app).post('/v1/internal/payments/orders/bk_01-1/expire').set('x-service-key', KEY);
    expect(response.status).toBe(503);
  });
});

describe('internal routes are not public', () => {
  it('does not serve the old unprefixed paths', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/internal/snap').set('x-service-key', KEY).send(SNAP_BODY);
    expect(response.status).toBe(404);
  });
});
