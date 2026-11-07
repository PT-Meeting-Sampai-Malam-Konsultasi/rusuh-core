const { computeSignatureKey } = require('@/domain/signature');
const { createMemoryStore } = require('@/infrastructure/persistence/memory-store');
const { createWebhookUseCase } = require('../webhook.use-case');

const SERVER_KEY = 'test-server-key';
const BOOKING_ID = 'bk_01';
const ORDER_ID = 'bk_01-1';
const GROSS = 3015000;
const START_TIME = new Date('2026-11-14T03:40:00.000Z');

/**
 * Builds a valid Midtrans notification body (signature computed with the test key).
 *
 * @param {object} [overrides] - Field overrides (signature is recomputed after).
 * @returns {object} Notification body.
 */
function notification(overrides = {}) {
  const body = {
    order_id: ORDER_ID,
    status_code: '200',
    gross_amount: '3015000.00',
    transaction_status: 'settlement',
    transaction_id: 'tx-1',
    payment_type: 'qris',
    currency: 'IDR',
    ...overrides
  };
  body.signature_key = computeSignatureKey({
    orderId: body.order_id,
    statusCode: body.status_code,
    grossAmount: body.gross_amount,
    serverKey: SERVER_KEY
  });
  return body;
}

/**
 * Builds a webhook service with a seeded payment order and stubbed deps.
 *
 * @param {object} [options] - Harness options.
 * @param {Function} [options.getStatusImpl] - Stub for confirmViaGetStatus.
 * @param {Function} [options.coreImpl] - Stub for core notifyPaymentResult.
 * @returns {Promise<object>} { store, service, statusUseCase, coreClient, metrics }.
 */
async function buildHarness({ getStatusImpl, coreImpl } = {}) {
  const store = createMemoryStore();
  await store.createPaymentOrder({
    orderId: ORDER_ID,
    bookingId: BOOKING_ID,
    attempt: 1,
    grossAmount: GROSS,
    snapStartTime: START_TIME
  });

  const statusUseCase = {
    confirmViaGetStatus: jest.fn(async (orderId) => {
      if (getStatusImpl) return getStatusImpl(orderId);
      return {
        orderId,
        transactionId: 'tx-1',
        transactionStatus: 'settlement',
        fraudStatus: 'accept',
        paymentType: 'qris',
        grossAmount: '3015000.00',
        statusCode: '200',
        currency: 'IDR'
      };
    })
  };
  const coreClient = {
    notifyPaymentResult: jest.fn(async () => {
      if (coreImpl) return coreImpl();
      return { bookingStatus: 'PAID', actionTaken: 'paid' };
    })
  };
  const metrics = { increment: jest.fn() };
  const service = createWebhookUseCase({
    store,
    statusUseCase,
    coreClient,
    serverKey: SERVER_KEY,
    metrics,
    logger: undefined,
    sleep: async () => {}
  });
  return { store, service, statusUseCase, coreClient, metrics };
}

module.exports = { notification, buildHarness, SERVER_KEY, BOOKING_ID, ORDER_ID, GROSS };
