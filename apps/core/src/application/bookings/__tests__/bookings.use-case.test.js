const { MemoryStore } = require('@/infrastructure/persistence/store');
const { MemoryStock } = require('@/infrastructure/cache/stock');
const { MemoryEventBus } = require('@/infrastructure/messaging/events');
const { createBookingUseCase } = require('@/application/bookings/bookings.use-case');
const { mayAccessBooking } = require('@/presentation/http/middleware/auth');
const { createDefaultDeps } = require('@/container');
const { loadEnvironment } = require('@/infrastructure/config/environment');
const { issueValidationToken } = require('@/domain/validation-token');
const { hmacNik } = require('@/domain/nik');

const FEES = { platformFee: 30000, adminFee: 15000, ppnRate: 0.11, tax2Rate: 0, tax2Base: 0 };
const NIK_KEY = Buffer.from('d'.repeat(32));
const NIK = '3171010101900001';

function makeValidationToken() {
  const { validationToken } = issueValidationToken(
    {
      eventId: 'evt_2026_gbk',
      fieldIndex: 0,
      fullName: 'Edy Supardi',
      nik: NIK,
      nikHmac: hmacNik(NIK, 'test-hmac-key'),
      nikMasked: '3171 •••• •••• 0001'
    },
    NIK_KEY
  );
  return validationToken;
}

function buildUseCase({ payment } = {}) {
  const store = new MemoryStore();
  const stock = new MemoryStock();
  const eventBus = new MemoryEventBus();
  const queueFeed = { stockChanged: jest.fn(async () => true) };
  const useCase = createBookingUseCase({
    queueFeed,
    store,
    stock,
    payment: payment || {
      isStub: false,
      createSnap: async ({ orderId }) => ({ orderId, snapToken: 'snap-1', redirectUrl: 'https://pay.example/1' }),
      getStatus: async () => ({ status: 'pending', grossAmount: 0, transactionId: null, paymentType: null }),
      expire: async () => {}
    },
    eventBus,
    accounts: {
      getAccount: async (id) => ({ id, email: 'buyer@example.com', locale: 'id', fullName: 'Edy Supardi' })
    },
    emailConfig: { webBaseUrl: 'https://web.test', refundWindowLabel: { id: '14 hari kerja', en: '14 business days' } },
    nikHmacKey: 'test-hmac-key',
    nikEncryptionKey: NIK_KEY,
    qrKey: 'test-qr-key',
    fees: FEES,
    mayAccessBooking
  });
  return { store, stock, eventBus, queueFeed, useCase };
}

const ACCOUNT = { sub: 'acc_1' };
const ADMISSION = { token: 'adm_1', slotId: 's_1', maxTickets: 3 };

function createBody(validationToken) {
  return {
    eventId: 'evt_2026_gbk',
    tickets: [{ categoryId: 'cat_vip', validationToken }]
  };
}

describe('booking use case (state transitions)', () => {
  it('creates a SELECTION booking with the LLD-02 price breakdown', async () => {
    const { store, useCase } = buildUseCase();
    const { booking, created } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    expect(created).toBe(true);
    expect(booking.status).toBe('SELECTION');
    expect(booking.price.ticketSubtotal.amount).toBe(3500000);
    expect(booking.price.total.amount).toBe(3500000 + 30000 + 15000 + 3300);
    expect(booking.attendees).toHaveLength(1);
    expect(booking.attendees[0].nikMasked).toBe('3171 •••• •••• 0001');
    expect(await store.getBooking(booking.bookingId)).toMatchObject({ bookingId: booking.bookingId });
  });

  it('returns the existing booking for the same admission (idempotent)', async () => {
    const { useCase } = buildUseCase();
    const first = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const second = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    expect(second.created).toBe(false);
    expect(second.booking.bookingId).toBe(first.booking.bookingId);
  });

  it('refuses a second active booking for the same account + event (Q8)', async () => {
    const { useCase } = buildUseCase();
    await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    await expect(
      useCase.createBooking(
        ACCOUNT,
        { token: 'adm_2', slotId: 's_2', maxTickets: 3 },
        createBody(makeValidationToken())
      )
    ).rejects.toMatchObject({ code: 'ACCOUNT_HAS_ACTIVE_BOOKING' });
  });

  it('rejects more tickets than the admission allows (QUANTITY_OVER_RESERVATION)', async () => {
    const { useCase } = buildUseCase();
    const token = makeValidationToken();
    const body = {
      eventId: 'evt_2026_gbk',
      tickets: [1, 2, 3].map(() => ({ categoryId: 'cat_vip', validationToken: token }))
    };
    await expect(
      useCase.createBooking(ACCOUNT, { token: 'adm_1', slotId: 's_1', maxTickets: 2 }, body)
    ).rejects.toMatchObject({
      code: 'QUANTITY_OVER_RESERVATION'
    });
  });

  it('never resurrects an EXPIRED booking on a late payment (D11)', async () => {
    const { store, stock, eventBus, useCase } = buildUseCase();
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    await useCase.enterPayment(booking.bookingId, { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } });
    const held = await store.getBooking(booking.bookingId);
    await useCase.expireBooking(held, 'expired');
    const result = await useCase.confirmPayment(booking.bookingId, {
      orderId: `${booking.bookingId}-1`,
      transactionId: 'txn_late',
      transactionStatus: 'settlement',
      paymentType: 'gopay',
      grossAmount: 3548300
    });
    expect(result.handled).toBe(true);
    expect(result.late).toBe(true);
    expect((await store.getBooking(booking.bookingId)).status).toBe('EXPIRED');
    expect((await store.getBooking(booking.bookingId)).refundRequired).toBe(true);
    expect(await store.listTicketsByAccount('acc_1')).toHaveLength(0);
    // Expiry enqueued EMAIL_EXPIRED, the late settlement EMAIL_REFUND_FLAGGED
    // (ADR-0009) — both addressed to the buyer's real e-mail (LLD-04 §3).
    expect(eventBus.emailJobs.map((job) => job.type)).toEqual(['EMAIL_EXPIRED', 'EMAIL_REFUND_FLAGGED']);
    const refund = eventBus.emailJobs[1];
    expect(refund.to).toBe('buyer@example.com');
    expect(refund.booking_id).toBe(booking.bookingId);
    expect(refund.variables.transaction_id).toBe('txn_late');
    expect(refund.variables.payment_method).toBe('GoPay');
    expect(refund.variables.refund_window).toBe('14 hari kerja');
    expect(refund.variables.order_code).toBe(booking.orderCode);
  });

  it('enqueues the EMAIL_TICKET envelope to the buyer on settlement', async () => {
    const { store, stock, eventBus, useCase } = buildUseCase();
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    await useCase.enterPayment(booking.bookingId, { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } });
    const result = await useCase.confirmPayment(booking.bookingId, {
      orderId: `${booking.bookingId}-1`,
      transactionId: 'txn_ok',
      transactionStatus: 'settlement',
      paymentType: 'bank_transfer',
      grossAmount: 3548300
    });
    expect(result.handled).toBe(true);
    expect(eventBus.emailJobs).toHaveLength(1);
    const envelope = eventBus.emailJobs[0];
    expect(envelope.type).toBe('EMAIL_TICKET');
    expect(envelope.to).toBe('buyer@example.com');
    expect(envelope.locale).toBe('id');
    expect(envelope.booking_id).toBe(booking.bookingId);
    expect(envelope.variables.order_code).toBe(booking.orderCode);
    expect(envelope.variables.total).toBe('Rp 3.548.300');
    expect(envelope.variables.payment_method).toBe('Transfer bank');
    expect(envelope.variables.count).toBe(1);
    expect(envelope.variables.tickets).toHaveLength(1);
    expect(envelope.variables.tickets[0]).toMatchObject({
      index: 1,
      category: 'VIP',
      holder_name: 'Edy Supardi',
      ticket_code: expect.stringMatching(/^SMD-VIP-/)
    });
    // A duplicate webhook does not enqueue a second e-mail (email_log dedup).
    await useCase.confirmPayment(booking.bookingId, {
      orderId: `${booking.bookingId}-1`,
      transactionId: 'txn_ok',
      transactionStatus: 'settlement',
      paymentType: 'bank_transfer',
      grossAmount: 3548300
    });
    expect(eventBus.emailJobs).toHaveLength(1);
    expect(await store.getBooking(booking.bookingId)).toMatchObject({ status: 'PAID' });
  });

  it('createDefaultDeps builds a working graph in test mode', () => {
    const config = loadEnvironment({ NODE_ENV: 'test' });
    const deps = createDefaultDeps(config);
    expect(deps.useCases.bookings).toBeDefined();
    expect(deps.useCases.events).toBeDefined();
    expect(deps.useCases.attendees).toBeDefined();
    expect(deps.useCases.tickets).toBeDefined();
    expect(deps.useCases.admission).toBeDefined();
    expect(deps.auth.requireAccount).toBeDefined();
    expect(deps.sweeper).toBeDefined();
  });
});

describe('booking use case (error paths)', () => {
  it('createBookingUseCase requires mayAccessBooking', () => {
    const store = new MemoryStore();
    expect(() =>
      createBookingUseCase({
        store,
        stock: new MemoryStock(),
        payment: {},
        eventBus: new MemoryEventBus(),
        nikHmacKey: 'k',
        nikEncryptionKey: NIK_KEY,
        qrKey: 'q',
        fees: FEES
      })
    ).toThrow('createBookingUseCase requires mayAccessBooking');
  });

  it('createBooking rejects an unknown event, an empty ticket list, and >3 tickets', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.createBooking(ACCOUNT, ADMISSION, { eventId: 'evt_missing', tickets: [] })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    await expect(
      useCase.createBooking(ACCOUNT, ADMISSION, { eventId: 'evt_2026_gbk', tickets: [] })
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    });
    const token = makeValidationToken();
    const four = {
      eventId: 'evt_2026_gbk',
      tickets: [1, 2, 3, 4].map(() => ({ categoryId: 'cat_vip', validationToken: token }))
    };
    await expect(useCase.createBooking(ACCOUNT, ADMISSION, four)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('createBooking rejects two attendees with the same NIK (DUPLICATE_NIK)', async () => {
    const { useCase } = buildUseCase();
    const token = makeValidationToken();
    const body = {
      eventId: 'evt_2026_gbk',
      tickets: [
        { categoryId: 'cat_vip', validationToken: token },
        { categoryId: 'cat_vip', validationToken: token }
      ]
    };
    await expect(useCase.createBooking(ACCOUNT, ADMISSION, body)).rejects.toMatchObject({ code: 'DUPLICATE_NIK' });
  });

  it('createBooking soft-checks stock (CATEGORY_SOLD_OUT) and the NIK quota (NIK_SEAT_TAKEN)', async () => {
    const { stock, useCase } = buildUseCase();
    // Drain VIP stock (500 seats) so the soft check fails.
    await stock.checkAndHold('evt_2026_gbk', [{ categoryId: 'cat_vip', qty: 500, nikHmacs: [] }]);
    await expect(useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()))).rejects.toMatchObject({
      code: 'CATEGORY_SOLD_OUT'
    });

    const second = buildUseCase();
    // Fill the NIK quota (3 seats) so the soft check fails.
    const nikHmac = hmacNik(NIK, 'test-hmac-key');
    await second.stock.checkAndHold('evt_2026_gbk', [{ categoryId: 'cat_vip', qty: 3, nikHmacs: [nikHmac] }]);
    await expect(
      second.useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()))
    ).rejects.toMatchObject({
      code: 'NIK_SEAT_TAKEN'
    });
  });

  it('getBooking throws 404 for a missing booking', async () => {
    const { useCase } = buildUseCase();
    await expect(useCase.getBooking('bk_missing', { account: { sub: 'acc_1' } })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('enterPayment refuses a PAID booking and an expired SELECTION booking (BOOKING_NOT_HELD)', async () => {
    const { store, stock, useCase } = buildUseCase();
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const caller = { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } };
    await useCase.enterPayment(booking.bookingId, caller);
    await useCase.confirmPayment(booking.bookingId, {
      orderId: `${booking.bookingId}-1`,
      transactionId: 'txn_1',
      transactionStatus: 'settlement',
      paymentType: 'gopay',
      grossAmount: 3548300
    });
    expect((await store.getBooking(booking.bookingId)).status).toBe('PAID');
    await expect(useCase.enterPayment(booking.bookingId, caller)).rejects.toMatchObject({ code: 'BOOKING_NOT_HELD' });

    const second = buildUseCase();
    const created = await second.useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    await second.store.updateBooking(created.booking.bookingId, {
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });
    await expect(second.useCase.enterPayment(created.booking.bookingId, caller)).rejects.toMatchObject({
      code: 'BOOKING_NOT_HELD'
    });
  });

  it('enterPayment maps a failed Lua hold to CATEGORY_SOLD_OUT / NIK_SEAT_TAKEN', async () => {
    const { stock, useCase } = buildUseCase();
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const caller = { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } };

    const soldOut = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    await stock.checkAndHold('evt_2026_gbk', [{ categoryId: 'cat_vip', qty: 500, nikHmacs: [] }]);
    await expect(useCase.enterPayment(soldOut.booking.bookingId, caller)).rejects.toMatchObject({
      code: 'CATEGORY_SOLD_OUT'
    });

    const second = buildUseCase();
    await second.stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const quota = await second.useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const nikHmac = hmacNik(NIK, 'test-hmac-key');
    await second.stock.checkAndHold('evt_2026_gbk', [{ categoryId: 'cat_vip', qty: 3, nikHmacs: [nikHmac] }]);
    await expect(second.useCase.enterPayment(quota.booking.bookingId, caller)).rejects.toMatchObject({
      code: 'NIK_SEAT_TAKEN'
    });
  });

  it('enterPayment releases the hold and refuses when the DB transition races (BOOKING_NOT_HELD)', async () => {
    const { store, stock, useCase } = buildUseCase();
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const availableBefore = await stock.getAvailable('evt_2026_gbk', 'cat_vip');
    store.updateBookingStatus = async () => null; // someone else transitioned it meanwhile
    const caller = { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } };
    await expect(useCase.enterPayment(booking.bookingId, caller)).rejects.toMatchObject({ code: 'BOOKING_NOT_HELD' });
    // The hold we just made was released.
    expect(await stock.getAvailable('evt_2026_gbk', 'cat_vip')).toBe(availableBefore);
  });

  it('enterPayment returns 503 when Snap creation fails (retryable)', async () => {
    const { stock, useCase } = buildUseCase({
      payment: {
        isStub: false,
        createSnap: async () => {
          throw new Error('midtrans down');
        },
        getStatus: async () => null,
        expire: async () => {}
      }
    });
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const caller = { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } };
    const error = await useCase.enterPayment(booking.bookingId, caller).catch((e) => e);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.status).toBe(503);
  });

  it('checkStatus throws 404 for a missing booking and expires on an expire status', async () => {
    const { useCase } = buildUseCase();
    await expect(useCase.checkStatus('bk_missing', { account: { sub: 'acc_1' } })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });

    const expiring = buildUseCase({
      payment: {
        isStub: false,
        createSnap: async ({ orderId }) => ({ orderId, snapToken: 'snap-1', redirectUrl: 'https://pay.example/1' }),
        getStatus: async () => ({
          status: 'expire',
          grossAmount: 3548300,
          transactionId: 'txn_1',
          paymentType: 'gopay'
        }),
        expire: async () => {}
      }
    });
    await expiring.stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await expiring.useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const caller = { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } };
    await expiring.useCase.enterPayment(booking.bookingId, caller);
    const checked = await expiring.useCase.checkStatus(booking.bookingId, caller);
    expect(checked.status).toBe('EXPIRED');
  });

  it('confirmPayment rejects an amount mismatch and never resurrects', async () => {
    const { store, stock, useCase } = buildUseCase();
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const caller = { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } };
    await useCase.enterPayment(booking.bookingId, caller);
    const result = await useCase.confirmPayment(booking.bookingId, {
      orderId: `${booking.bookingId}-1`,
      transactionId: 'txn_1',
      transactionStatus: 'settlement',
      paymentType: 'gopay',
      grossAmount: 1
    });
    expect(result).toEqual({ handled: false, reason: 'amount_mismatch' });
    expect((await store.getBooking(booking.bookingId)).status).toBe('PAYMENT_PENDING');
  });

  it('expireBooking still expires when the Midtrans expire call fails (best-effort)', async () => {
    const { store, stock, useCase } = buildUseCase({
      payment: {
        isStub: false,
        createSnap: async ({ orderId }) => ({ orderId, snapToken: 'snap-1', redirectUrl: 'https://pay.example/1' }),
        getStatus: async () => null,
        expire: async () => {
          throw new Error('midtrans down');
        }
      }
    });
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const caller = { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } };
    await useCase.enterPayment(booking.bookingId, caller);
    const held = await store.getBooking(booking.bookingId);
    const expired = await useCase.expireBooking(held, 'expired');
    expect(expired.status).toBe('EXPIRED');
  });
});

describe('booking use case (queue feed, booking.v1 outbox)', () => {
  const DEVICE = 'w_lCphzERtHxSl8yRoXHcx0g';
  const QUEUE_ADMISSION = { token: 'adm_q', slotId: 's_q', maxTickets: 3, deviceId: DEVICE };
  const CALLER = { account: { sub: 'acc_1' }, admission: { token: 'adm_q' } };

  async function held() {
    const built = buildUseCase();
    await built.stock.setAdmission(
      'adm_q',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_q', max_tickets: 3, device_id: DEVICE },
      60000
    );
    const { booking } = await built.useCase.createBooking(ACCOUNT, QUEUE_ADMISSION, createBody(makeValidationToken()));
    const payment = await built.useCase.enterPayment(booking.bookingId, CALLER);
    return { ...built, booking, payment };
  }

  it('keeps the device of the admission on the booking', async () => {
    const { useCase } = buildUseCase();
    const { booking } = await useCase.createBooking(ACCOUNT, QUEUE_ADMISSION, createBody(makeValidationToken()));
    expect(booking.deviceId).toBe(DEVICE);
  });

  it('reads the device from the admission token when core has none stored (admissions before BR-06-Q1)', async () => {
    const { useCase } = buildUseCase();
    const payload = Buffer.from(JSON.stringify({ sub: DEVICE })).toString('base64url');
    const { booking } = await useCase.createBooking(
      ACCOUNT,
      { token: `eyJhbGciOiJFZERTQSJ9.${payload}.c2ln`, slotId: 's_q', maxTickets: 3 },
      createBody(makeValidationToken())
    );
    expect(booking.deviceId).toBe(DEVICE);
  });

  it('records booking.held with the payment deadline at payment entry, and snapshots the stock', async () => {
    const { store, queueFeed, booking, payment } = await held();
    expect(store.outbox).toEqual([
      {
        id: expect.any(String),
        type: 'booking.held',
        payload: expect.objectContaining({
          v: 1,
          type: 'booking.held',
          eventId: 'evt_2026_gbk',
          slotId: 's_q',
          deviceId: DEVICE,
          bookingId: booking.bookingId,
          units: 1,
          paymentDeadline: payment.paymentExpiresAt
        }),
        sent: false
      }
    ]);
    expect(store.outbox[0].payload.id).toBe(store.outbox[0].id);
    expect(queueFeed.stockChanged).toHaveBeenCalledWith('evt_2026_gbk');
  });

  it('records booking.paid on settlement', async () => {
    const { store, useCase, booking } = await held();
    await useCase.confirmPayment(booking.bookingId, {
      orderId: `${booking.bookingId}-1`,
      transactionId: 'txn_1',
      transactionStatus: 'settlement',
      paymentType: 'gopay',
      grossAmount: 3548300
    });
    expect(store.outbox.map((row) => row.type)).toEqual(['booking.held', 'booking.paid']);
    expect(store.outbox[1].payload).not.toHaveProperty('paymentDeadline');
  });

  it('records booking.expired when a held booking expires, and snapshots the released stock', async () => {
    const { store, queueFeed, useCase, booking } = await held();
    queueFeed.stockChanged.mockClear();
    await useCase.expireBooking(await store.getBooking(booking.bookingId), 'expired');
    expect(store.outbox.map((row) => row.type)).toEqual(['booking.held', 'booking.expired']);
    expect(queueFeed.stockChanged).toHaveBeenCalledWith('evt_2026_gbk');
  });

  it('records nothing when a booking expires before payment (the queue never saw a hold)', async () => {
    const { store, useCase } = buildUseCase();
    const { booking } = await useCase.createBooking(ACCOUNT, QUEUE_ADMISSION, createBody(makeValidationToken()));
    await useCase.expireBooking(booking, 'expired');
    expect(store.outbox).toEqual([]);
  });

  it('records nothing for a late payment on an expired booking', async () => {
    const { store, useCase, booking } = await held();
    await useCase.expireBooking(await store.getBooking(booking.bookingId), 'expired');
    await useCase.confirmPayment(booking.bookingId, {
      orderId: `${booking.bookingId}-1`,
      transactionId: 'txn_late',
      transactionStatus: 'settlement',
      paymentType: 'gopay',
      grossAmount: 3548300
    });
    expect(store.outbox.map((row) => row.type)).toEqual(['booking.held', 'booking.expired']);
  });

  it('still moves the booking when there is no device to report, without an event', async () => {
    const { store, stock, useCase } = buildUseCase();
    await stock.setAdmission('adm_1', { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1' }, 60000);
    const { booking } = await useCase.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    await useCase.enterPayment(booking.bookingId, { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } });
    expect((await store.getBooking(booking.bookingId)).status).toBe('PAYMENT_PENDING');
    expect(store.outbox).toEqual([]);
  });

  it('no longer sends empty-slot messages (nothing reads them; the stream replaces them)', async () => {
    const { eventBus, store, useCase, booking } = await held();
    await useCase.expireBooking(await store.getBooking(booking.bookingId), 'expired');
    expect(eventBus.emptySlotEvents).toBeUndefined();
  });
});
