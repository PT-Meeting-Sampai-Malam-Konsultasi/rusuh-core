const http = require('http');
const { PaymentClient } = require('../../../core/src/infrastructure/external/payment');
const { loadEnvironment } = require('../infrastructure/config/environment');
const { createApp } = require('../app');
const { buildPaymentDeps } = require('../container');
const { createMemoryStore } = require('../infrastructure/persistence/memory-store');
const { MidtransError } = require('../domain/ports/midtrans');

/**
 * Contract test: core's real PaymentClient (real fetch, real HTTP) against the
 * real payment Express app. Only Midtrans, behind the MidtransClient port, is
 * faked. A path, header or body drift between the two modules fails here
 * instead of in production (the checkout 503 of 2026-11-13).
 */
const KEY = 'contract-test-key';
const START = '2026-11-14T03:40:00.000Z';
const ITEMS = [{ id: 'cat_festival_b', price: 3015000, quantity: 1, name: 'Festival B' }];

let server;
let baseUrl;
let store;
let midtrans;

beforeAll(async () => {
  const config = loadEnvironment({ MIDTRANS_SERVER_KEY: 'sk-test', CORE_SERVICE_CREDENTIAL: KEY });
  store = createMemoryStore();
  midtrans = {
    createSnap: jest.fn(),
    getStatus: jest.fn(),
    expire: jest.fn()
  };
  const deps = buildPaymentDeps(config, { store, midtransClient: midtrans, logger: undefined });
  server = http.createServer(createApp({ config, deps }));
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

beforeEach(() => {
  store = undefined;
});

function client(serviceKey = KEY) {
  return new PaymentClient({ baseUrl, serviceKey, timeoutMs: 2000 });
}

function snapInput(attempt, bookingId = 'bk_c1') {
  return {
    bookingId,
    attempt,
    orderId: `${bookingId}-${attempt}`,
    grossAmount: 3015000,
    itemDetails: ITEMS,
    snapStartTime: START
  };
}

describe('core PaymentClient -> payment router', () => {
  it('createSnap succeeds with the right credential', async () => {
    midtrans.createSnap.mockResolvedValue({ token: 'tok-1', redirectUrl: 'https://snap/tok-1' });
    const result = await client().createSnap(snapInput(1, 'bk_snap'));
    expect(result).toMatchObject({ orderId: 'bk_snap-1', snapToken: 'tok-1', redirectUrl: 'https://snap/tok-1' });
    expect(midtrans.createSnap).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'bk_snap-1' }));
  });

  it('createSnap for attempt 2 keeps core and payment on the same orderId', async () => {
    midtrans.createSnap.mockResolvedValue({ token: 'tok-n', redirectUrl: 'https://snap/n' });
    await client().createSnap(snapInput(1, 'bk_retry'));
    const second = await client().createSnap({
      ...snapInput(2, 'bk_retry'),
      snapStartTime: '2026-11-14T03:45:00.000Z'
    });
    expect(second.orderId).toBe('bk_retry-2');
    expect(midtrans.createSnap).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderId: 'bk_retry-2', startTime: new Date(START) })
    );
  });

  it.each([
    ['a wrong credential', 'wrong-key'],
    ['no credential', undefined],
    ['a credential of a different length', 'x']
  ])('is rejected with 401 for %s', async (_name, serviceKey) => {
    const unauthenticated = serviceKey === undefined ? new PaymentClient({ baseUrl }) : client(serviceKey);
    await expect(unauthenticated.createSnap(snapInput(1, 'bk_auth'))).rejects.toMatchObject({ status: 401 });
    await expect(unauthenticated.getStatus('bk_auth-1')).rejects.toMatchObject({ status: 401 });
    await expect(unauthenticated.expire('bk_auth-1')).rejects.toMatchObject({ status: 401 });
  });

  it('getStatus returns the status body the core use case reads', async () => {
    midtrans.getStatus.mockResolvedValue({
      order_id: 'bk_st-1',
      transaction_id: 'tx-9',
      transaction_status: 'settlement',
      payment_type: 'qris',
      gross_amount: '3015000.00',
      status_code: '200'
    });
    await expect(client().getStatus('bk_st-1')).resolves.toEqual({
      status: 'settlement',
      grossAmount: '3015000.00',
      transactionId: 'tx-9',
      paymentType: 'qris'
    });
  });

  it('getStatus returns null on 404 (no transaction yet)', async () => {
    midtrans.getStatus.mockRejectedValue(new MidtransError('missing', 404));
    await expect(client().getStatus('bk_none-1')).resolves.toBeNull();
  });

  it('expire resolves on success and ignores 412 (already expired or settled)', async () => {
    midtrans.expire.mockResolvedValueOnce({});
    await expect(client().expire('bk_ex-1')).resolves.toBeUndefined();
    midtrans.expire.mockRejectedValueOnce(new MidtransError('gone', 412));
    await expect(client().expire('bk_ex-1')).resolves.toBeUndefined();
  });

  it('expire surfaces a payment failure as an error', async () => {
    midtrans.expire.mockRejectedValueOnce(new MidtransError('boom', 500));
    await expect(client().expire('bk_ex-2')).rejects.toMatchObject({ status: 502 });
  });
});
