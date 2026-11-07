const { MemoryStore } = require('@/infrastructure/store');
const { MemoryStock } = require('@/infrastructure/stock');
const { MemoryEventBus } = require('@/infrastructure/events');
const { createBookingService } = require('@/modules/bookings/bookings.service');
const { createDefaultDeps } = require('@/infrastructure/deps');
const { loadEnvironment } = require('@/config/environment');
const { issueValidationToken } = require('@/modules/attendees/validation-token');
const { hmacNik } = require('@/lib/nik');

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

function buildService() {
  const store = new MemoryStore();
  const stock = new MemoryStock();
  const eventBus = new MemoryEventBus();
  const service = createBookingService({
    store,
    stock,
    payment: {
      isStub: false,
      createSnap: async ({ orderId }) => ({ orderId, snapToken: 'snap-1', redirectUrl: 'https://pay.example/1' }),
      getStatus: async () => ({ status: 'pending', grossAmount: 0, transactionId: null, paymentType: null }),
      expire: async () => {}
    },
    eventBus,
    nikHmacKey: 'test-hmac-key',
    nikEncryptionKey: NIK_KEY,
    qrKey: 'test-qr-key',
    fees: FEES
  });
  return { store, stock, eventBus, service };
}

const ACCOUNT = { sub: 'acc_1' };
const ADMISSION = { token: 'adm_1', slotId: 's_1', maxTickets: 3 };

function createBody(validationToken) {
  return {
    eventId: 'evt_2026_gbk',
    tickets: [{ categoryId: 'cat_vip', validationToken }]
  };
}

describe('booking service (state transitions)', () => {
  it('creates a SELECTION booking with the LLD-02 price breakdown', async () => {
    const { store, service } = buildService();
    const { booking, created } = await service.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    expect(created).toBe(true);
    expect(booking.status).toBe('SELECTION');
    expect(booking.price.ticketSubtotal.amount).toBe(3500000);
    expect(booking.price.total.amount).toBe(3500000 + 30000 + 15000 + 3300);
    expect(booking.attendees).toHaveLength(1);
    expect(booking.attendees[0].nikMasked).toBe('3171 •••• •••• 0001');
    expect(await store.getBooking(booking.bookingId)).toMatchObject({ bookingId: booking.bookingId });
  });

  it('returns the existing booking for the same admission (idempotent)', async () => {
    const { service } = buildService();
    const first = await service.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    const second = await service.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    expect(second.created).toBe(false);
    expect(second.booking.bookingId).toBe(first.booking.bookingId);
  });

  it('refuses a second active booking for the same account + event (Q8)', async () => {
    const { service } = buildService();
    await service.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    await expect(
      service.createBooking(
        ACCOUNT,
        { token: 'adm_2', slotId: 's_2', maxTickets: 3 },
        createBody(makeValidationToken())
      )
    ).rejects.toMatchObject({ code: 'ACCOUNT_HAS_ACTIVE_BOOKING' });
  });

  it('rejects more tickets than the admission allows (QUANTITY_OVER_RESERVATION)', async () => {
    const { service } = buildService();
    const token = makeValidationToken();
    const body = {
      eventId: 'evt_2026_gbk',
      tickets: [1, 2, 3].map(() => ({ categoryId: 'cat_vip', validationToken: token }))
    };
    await expect(
      service.createBooking(ACCOUNT, { token: 'adm_1', slotId: 's_1', maxTickets: 2 }, body)
    ).rejects.toMatchObject({
      code: 'QUANTITY_OVER_RESERVATION'
    });
  });

  it('never resurrects an EXPIRED booking on a late payment (D11)', async () => {
    const { store, stock, eventBus, service } = buildService();
    await stock.setAdmission(
      'adm_1',
      { user_id: 'acc_1', event_id: 'evt_2026_gbk', slot_id: 's_1', max_tickets: 3 },
      60000
    );
    const { booking } = await service.createBooking(ACCOUNT, ADMISSION, createBody(makeValidationToken()));
    await service.enterPayment(booking.bookingId, { account: { sub: 'acc_1' }, admission: { token: 'adm_1' } });
    const held = await store.getBooking(booking.bookingId);
    await service.expireBooking(held, 'expired');
    const result = await service.confirmPayment(booking.bookingId, {
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
    expect(eventBus.emptySlotEvents).toHaveLength(1); // from the expiry only
  });

  it('createDefaultDeps builds a working graph in test mode', () => {
    const config = loadEnvironment({ NODE_ENV: 'test' });
    const deps = createDefaultDeps(config);
    expect(deps.services.bookings).toBeDefined();
    expect(deps.services.events).toBeDefined();
    expect(deps.services.attendees).toBeDefined();
    expect(deps.services.tickets).toBeDefined();
    expect(deps.auth.requireAccount).toBeDefined();
    expect(deps.sweeper).toBeDefined();
    expect(deps.admissionConsumer).toBeDefined();
  });
});
