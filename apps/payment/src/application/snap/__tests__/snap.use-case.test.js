const { createMemoryStore } = require('@/infrastructure/persistence/memory-store');
const { createMidtransClient } = require('@/infrastructure/external/midtrans/midtrans-client');
const { createSnapUseCase } = require('../snap.use-case');

function mockFetch(handler) {
  return jest.fn(async (url, options) => handler(url, options));
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const START_TIME = new Date('2026-11-14T03:40:00.000Z');
const ITEMS = [{ id: 'cat_festival_b', price: 1500000, quantity: 2, name: 'Festival B' }];

function buildService({ fetchImpl } = {}) {
  const store = createMemoryStore();
  const midtransClient = createMidtransClient({
    serverKey: 'sk-test',
    fetchImpl:
      fetchImpl ||
      mockFetch(async () =>
        jsonResponse(201, {
          token: 'snap-token-1',
          redirect_url: 'https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-1'
        })
      )
  });
  const metrics = { increment: jest.fn() };
  const service = createSnapUseCase({ store, midtransClient, metrics, logger: undefined });
  return { store, service, metrics };
}

describe('createSnapTransaction', () => {
  it('creates attempt 1 with order_id {booking_id}-1 and returns the Snap token', async () => {
    const { store, service } = buildService();
    const result = await service.createSnapTransaction({
      bookingId: 'bk_01',
      grossAmount: 3000000,
      itemDetails: ITEMS,
      snapStartTime: START_TIME
    });
    expect(result.orderId).toBe('bk_01-1');
    expect(result.attempt).toBe(1);
    expect(result.snapToken).toBe('snap-token-1');
    expect(result.redirectUrl).toContain('snap-token-1');
    expect(result.gatewayExpiresAt).toEqual(new Date('2026-11-14T03:50:00.000Z'));
    const order = await store.getPaymentOrder('bk_01-1');
    expect(order.status).toBe('pending');
    expect(order.snapStartTime).toEqual(START_TIME);
  });

  it('re-create is a NEW attempt inheriting the ORIGINAL snap_start_time (no window extension)', async () => {
    const { store, service } = buildService();
    await service.createSnapTransaction({
      bookingId: 'bk_01',
      grossAmount: 3000000,
      itemDetails: ITEMS,
      snapStartTime: START_TIME
    });
    const later = new Date('2026-11-14T03:45:00.000Z');
    const second = await service.createSnapTransaction({
      bookingId: 'bk_01',
      grossAmount: 3000000,
      itemDetails: ITEMS,
      snapStartTime: later
    });
    expect(second.orderId).toBe('bk_01-2');
    expect(second.attempt).toBe(2);
    const order = await store.getPaymentOrder('bk_01-2');
    expect(order.snapStartTime).toEqual(START_TIME);
    expect(second.gatewayExpiresAt).toEqual(new Date('2026-11-14T03:50:00.000Z'));
  });

  it('a Snap failure leaves the order row as created (core retries with a new attempt)', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(500, { status_code: '500', status_message: 'Internal error' })
    );
    const { store, service, metrics } = buildService({ fetchImpl });
    await expect(
      service.createSnapTransaction({
        bookingId: 'bk_01',
        grossAmount: 3000000,
        itemDetails: ITEMS,
        snapStartTime: START_TIME
      })
    ).rejects.toMatchObject({ name: 'MidtransError', status: 500 });
    const order = await store.getPaymentOrder('bk_01-1');
    expect(order.status).toBe('created');
    expect(metrics.increment).toHaveBeenCalledWith('midtrans_5xx_count');
  });

  it('rejects invalid input', async () => {
    const { service } = buildService();
    await expect(
      service.createSnapTransaction({
        bookingId: 'bk_01',
        grossAmount: -5,
        itemDetails: ITEMS,
        snapStartTime: START_TIME
      })
    ).rejects.toMatchObject({ isBoom: true, output: { statusCode: 400 } });
  });
});
