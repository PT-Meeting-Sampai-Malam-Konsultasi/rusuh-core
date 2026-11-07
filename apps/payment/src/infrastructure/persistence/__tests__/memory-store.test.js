const { createMemoryStore } = require('../memory-store');

describe('memory store (payment_orders)', () => {
  it('creates an order and lists attempts per booking in order', async () => {
    const store = createMemoryStore();
    const start = new Date('2026-11-14T03:40:00.000Z');
    await store.createPaymentOrder({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      attempt: 1,
      grossAmount: 3015000,
      snapStartTime: start
    });
    await store.createPaymentOrder({
      orderId: 'bk_01-2',
      bookingId: 'bk_01',
      attempt: 2,
      grossAmount: 3015000,
      snapStartTime: start
    });
    const orders = await store.getPaymentOrdersByBooking('bk_01');
    expect(orders.map((order) => order.orderId)).toEqual(['bk_01-1', 'bk_01-2']);
    expect(orders[0].snapStartTime).toEqual(start);
    expect(await store.getPaymentOrder('bk_01-9')).toBeNull();
  });

  it('rejects a duplicate order_id and updates status', async () => {
    const store = createMemoryStore();
    const start = new Date();
    await store.createPaymentOrder({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      attempt: 1,
      grossAmount: 1000,
      snapStartTime: start
    });
    await expect(
      store.createPaymentOrder({
        orderId: 'bk_01-1',
        bookingId: 'bk_01',
        attempt: 1,
        grossAmount: 1000,
        snapStartTime: start
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_ORDER_ID' });
    const updated = await store.updatePaymentOrder('bk_01-1', { status: 'pending' });
    expect(updated.status).toBe('pending');
    expect(await store.updatePaymentOrder('bk_01-9', { status: 'pending' })).toBeNull();
  });
});

describe('memory store (payment_attempts + callback_log)', () => {
  it('enforces UNIQUE(transaction_id) and upserts on progression', async () => {
    const store = createMemoryStore();
    await store.createPaymentAttempt({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      transactionId: 'tx-1',
      transactionStatus: 'pending',
      paymentType: 'qris',
      grossAmount: 3015000,
      confirmed: false,
      rawPayload: {}
    });
    await expect(
      store.createPaymentAttempt({
        orderId: 'bk_01-1',
        bookingId: 'bk_01',
        transactionId: 'tx-1',
        transactionStatus: 'pending',
        paymentType: 'qris',
        grossAmount: 3015000,
        confirmed: false,
        rawPayload: {}
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_TRANSACTION_ID' });

    const progressed = await store.upsertPaymentAttempt({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      transactionId: 'tx-1',
      transactionStatus: 'settlement',
      paymentType: 'qris',
      grossAmount: 3015000,
      confirmed: true,
      rawPayload: {}
    });
    expect(progressed.transactionStatus).toBe('settlement');
    expect(progressed.confirmed).toBe(true);
    expect(await store.findPaymentAttempt('tx-unknown')).toBeNull();
  });

  it('upserts a NEW transaction_id by creating it (no existing row)', async () => {
    const store = createMemoryStore();
    const created = await store.upsertPaymentAttempt({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      transactionId: 'tx-new',
      transactionStatus: 'pending',
      paymentType: 'gopay',
      grossAmount: 3015000,
      confirmed: false,
      rawPayload: {}
    });
    expect(created.transactionId).toBe('tx-new');
    expect(created.transactionStatus).toBe('pending');
    const found = await store.findPaymentAttempt('tx-new');
    expect(found.transactionId).toBe('tx-new');
  });

  it('upsert on an existing row only overwrites the fields that are provided', async () => {
    const store = createMemoryStore();
    await store.createPaymentAttempt({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      transactionId: 'tx-1',
      transactionStatus: 'pending',
      paymentType: 'qris',
      grossAmount: 3015000,
      confirmed: false,
      rawPayload: {}
    });
    const updated = await store.upsertPaymentAttempt({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      transactionId: 'tx-1',
      transactionStatus: 'deny'
    });
    expect(updated.transactionStatus).toBe('deny');
    expect(updated.paymentType).toBe('qris');
    expect(updated.grossAmount).toBe(3015000);
    expect(updated.confirmed).toBe(false);
  });

  it('records callback logs including invalid signatures', async () => {
    const store = createMemoryStore();
    await store.createCallbackLog({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      signatureValid: false,
      transactionStatus: 'settlement'
    });
    await store.createCallbackLog({
      orderId: 'bk_01-1',
      bookingId: 'bk_01',
      signatureValid: true,
      transactionStatus: 'settlement'
    });
    const logs = await store.getCallbackLogs({ orderId: 'bk_01-1' });
    expect(logs).toHaveLength(2);
    expect(logs[0].signatureValid).toBe(false);
    expect(logs[1].signatureValid).toBe(true);
  });
});
