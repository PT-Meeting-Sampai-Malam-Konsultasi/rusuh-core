const { MemoryStore } = require('@/infrastructure/store');

describe('MemoryStore', () => {
  let store;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('seeds the Samudra event with 3 categories', async () => {
    const events = await store.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe('evt_2026_gbk');
    const categories = await store.getCategories('evt_2026_gbk');
    expect(categories).toHaveLength(3);
    expect(categories.map((category) => category.categoryId)).toEqual(['cat_vip', 'cat_festival_b', 'cat_tribune']);
  });

  it('creates and retrieves a booking', async () => {
    const booking = await store.createBooking({
      bookingId: 'bk_1',
      orderCode: 'RSH-26-000001',
      eventId: 'evt_2026_gbk',
      accountId: 'acc_1',
      admissionToken: 'adm_1',
      slotId: 's_1',
      status: 'SELECTION',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      paymentExpiresAt: null,
      price: { total: { amount: 100, currency: 'IDR' } },
      attendees: [],
      tickets: []
    });
    expect(booking.status).toBe('SELECTION');
    expect(await store.getBooking('bk_1')).toMatchObject({ bookingId: 'bk_1' });
    expect(await store.getActiveBookingByAdmission('adm_1')).toMatchObject({ bookingId: 'bk_1' });
    expect(await store.getActiveBookingByAccountEvent('acc_1', 'evt_2026_gbk')).toMatchObject({ bookingId: 'bk_1' });
  });

  it('guarded transitions only apply from the expected states', async () => {
    await store.createBooking({
      bookingId: 'bk_1',
      orderCode: 'RSH-26-000001',
      eventId: 'evt_2026_gbk',
      accountId: 'acc_1',
      admissionToken: 'adm_1',
      slotId: 's_1',
      status: 'SELECTION',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      paymentExpiresAt: null,
      price: { total: { amount: 100, currency: 'IDR' } },
      attendees: [],
      tickets: []
    });
    const moved = await store.updateBookingStatus('bk_1', 'SELECTION', 'PAYMENT_PENDING', { attempt: 1 });
    expect(moved).toMatchObject({ status: 'PAYMENT_PENDING' });
    const notMoved = await store.updateBookingStatus('bk_1', 'SELECTION', 'PAID', {});
    expect(notMoved).toBeNull();
    expect((await store.getBooking('bk_1')).status).toBe('PAYMENT_PENDING');
  });

  it('returns an empty list for due bookings when nothing is past deadline', async () => {
    await store.createBooking({
      bookingId: 'bk_1',
      orderCode: 'RSH-26-000001',
      eventId: 'evt_2026_gbk',
      accountId: 'acc_1',
      admissionToken: 'adm_1',
      slotId: 's_1',
      status: 'SELECTION',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      paymentExpiresAt: null,
      price: { total: { amount: 100, currency: 'IDR' } },
      attendees: [],
      tickets: []
    });
    expect(await store.listDueBookings(new Date().toISOString(), 100)).toHaveLength(0);
  });

  it('mints tickets with a pre-assigned sequence + code, paid-only listing', async () => {
    const booking = await store.createBooking({
      bookingId: 'bk_1',
      orderCode: 'RSH-26-000001',
      eventId: 'evt_2026_gbk',
      accountId: 'acc_1',
      admissionToken: 'adm_1',
      slotId: 's_1',
      status: 'SELECTION',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      paymentExpiresAt: null,
      price: { total: { amount: 100, currency: 'IDR' } },
      attendees: [],
      tickets: []
    });
    const tickets = await store.mintTickets(booking, [
      {
        ticketId: 'tk_1',
        ticketCode: 'SMD-VIP-00001',
        categoryId: 'cat_vip',
        categoryName: 'VIP',
        seating: 'seated',
        entryGate: 'Gerbang 1',
        holderName: 'Edy Supardi',
        nikMasked: '3171 •••• •••• 0001',
        qrPayload: 'RSH1.SMD-VIP-00001.sig',
        sequence: 1
      }
    ]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].ticketCode).toBe('SMD-VIP-00001');
    expect(await store.listTicketsByAccount('acc_1')).toHaveLength(0); // not PAID yet
    await store.updateBookingStatus('bk_1', 'SELECTION', 'PAID', {});
    expect(await store.listTicketsByAccount('acc_1')).toHaveLength(1);
    expect(await store.getTicket('tk_1')).toMatchObject({ ticketId: 'tk_1' });
  });

  it('dedups e-ticket emails via the email log', async () => {
    expect(await store.logEmail('bk_1', 'e-ticket')).toBe(true);
    expect(await store.logEmail('bk_1', 'e-ticket')).toBe(false);
    expect(await store.logEmail('bk_1', 'expired')).toBe(true);
  });

  it('counts NIK seats from the backstop', async () => {
    expect(await store.nikSeatCount('evt_2026_gbk', 'hmac-1')).toBe(0);
    await store.incrementNikBackstop('evt_2026_gbk', 'hmac-1', 2);
    expect(await store.nikSeatCount('evt_2026_gbk', 'hmac-1')).toBe(2);
    await store.incrementNikBackstop('evt_2026_gbk', 'hmac-1', -1);
    expect(await store.nikSeatCount('evt_2026_gbk', 'hmac-1')).toBe(1);
  });

  it('assigns sequential ticket numbers per category', async () => {
    expect(await store.nextTicketSeq('evt_2026_gbk', 'cat_vip')).toBe(1);
    expect(await store.nextTicketSeq('evt_2026_gbk', 'cat_vip')).toBe(2);
    expect(await store.nextTicketSeq('evt_2026_gbk', 'cat_festival_b')).toBe(1);
  });
});
