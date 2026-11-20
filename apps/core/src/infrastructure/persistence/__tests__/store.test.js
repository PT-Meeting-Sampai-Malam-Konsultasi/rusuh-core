const { MemoryStore } = require('@/infrastructure/persistence/store');

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
        nikHmac: 'hmac-1',
        nikCiphertext: 'ciphertext-1',
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

describe('MemoryStore booking outbox (booking.v1, ADR-0013)', () => {
  let store;
  const outbox = { id: 'ob_1', type: 'booking.held', payload: { id: 'ob_1', type: 'booking.held' } };

  beforeEach(async () => {
    store = new MemoryStore();
    await store.createBooking({
      bookingId: 'bk_1',
      orderCode: 'RSH-26-000001',
      eventId: 'evt_2026_gbk',
      accountId: 'acc_1',
      admissionToken: 'adm_1',
      slotId: 's_1',
      deviceId: 'w_lCphzERtHxSl8yRoXHcx0g',
      status: 'SELECTION',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      price: { total: { amount: 100, currency: 'IDR' } },
      attendees: [],
      tickets: []
    });
  });

  it('keeps the device of the admission on the booking', async () => {
    expect((await store.getBooking('bk_1')).deviceId).toBe('w_lCphzERtHxSl8yRoXHcx0g');
  });

  it('records the event only when the transition happens', async () => {
    await store.updateBookingStatus('bk_1', 'SELECTION', 'PAYMENT_PENDING', {}, outbox);
    await store.updateBookingStatus('bk_1', 'SELECTION', 'PAYMENT_PENDING', {}, { ...outbox, id: 'ob_2' });
    const sent = [];
    expect(await store.relayOutbox(10, async (row) => sent.push(row))).toBe(1);
    expect(sent).toEqual([outbox]);
  });

  it('sends each event once, in order', async () => {
    await store.updateBookingStatus('bk_1', 'SELECTION', 'PAYMENT_PENDING', {}, outbox);
    await store.updateBookingStatus(
      'bk_1',
      'PAYMENT_PENDING',
      'PAID',
      {},
      { ...outbox, id: 'ob_2', type: 'booking.paid' }
    );
    const sent = [];
    await store.relayOutbox(10, async (row) => sent.push(row.id));
    await store.relayOutbox(10, async (row) => sent.push(row.id));
    expect(sent).toEqual(['ob_1', 'ob_2']);
  });

  it('keeps an event whose send failed, and the ones after it, for the next run', async () => {
    await store.updateBookingStatus('bk_1', 'SELECTION', 'PAYMENT_PENDING', {}, outbox);
    await store.updateBookingStatus(
      'bk_1',
      'PAYMENT_PENDING',
      'PAID',
      {},
      { ...outbox, id: 'ob_2', type: 'booking.paid' }
    );
    await expect(
      store.relayOutbox(10, async () => {
        throw new Error('valkey down');
      })
    ).rejects.toThrow('valkey down');
    const sent = [];
    expect(await store.relayOutbox(10, async (row) => sent.push(row.id))).toBe(2);
    expect(sent).toEqual(['ob_1', 'ob_2']);
  });

  it('sends at most the limit per run', async () => {
    await store.updateBookingStatus('bk_1', 'SELECTION', 'PAYMENT_PENDING', {}, outbox);
    await store.updateBookingStatus(
      'bk_1',
      'PAYMENT_PENDING',
      'PAID',
      {},
      { ...outbox, id: 'ob_2', type: 'booking.paid' }
    );
    expect(await store.relayOutbox(1, async () => {})).toBe(1);
    expect(await store.relayOutbox(1, async () => {})).toBe(1);
    expect(await store.relayOutbox(1, async () => {})).toBe(0);
  });

  describe('payBookingWithTickets', () => {
    const baseBooking = {
      bookingId: 'bk_pay',
      orderCode: 'RSH-26-000009',
      eventId: 'evt_2026_gbk',
      accountId: 'acc_1',
      admissionToken: 'adm_pay',
      slotId: 's_1',
      status: 'PAYMENT_PENDING',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      paymentExpiresAt: new Date(Date.now() + 300000).toISOString(),
      price: { total: { amount: 100, currency: 'IDR' } },
      attendees: [],
      tickets: []
    };
    const row = (n) => ({
      ticketId: `tk_${n}`,
      ticketCode: `SMD-VIP-0000${n}`,
      categoryId: 'cat_vip',
      categoryName: 'VIP',
      seating: 'seated',
      entryGate: 'Gerbang 1',
      holderName: 'Edy Supardi',
      nikMasked: '3171 •••• •••• 0001',
      nikHmac: `hmac-${n}`,
      nikCiphertext: `cipher-${n}`,
      qrPayload: `RSH1.${n}`,
      sequence: n
    });
    const paidOutbox = { id: 'ob_1', type: 'booking.paid', payload: { bookingId: 'bk_pay' } };

    it('marks the booking PAID, writes the outbox row and issues every ticket together', async () => {
      await store.createBooking(baseBooking);
      const result = await store.payBookingWithTickets(
        'bk_pay',
        'PAYMENT_PENDING',
        { paidAt: '2026-11-19T10:00:00.000Z', paymentMethod: 'qris' },
        paidOutbox,
        [row(1), row(2)]
      );
      expect(result.booking).toMatchObject({ status: 'PAID', paymentMethod: 'qris' });
      expect(result.tickets).toHaveLength(2);
      expect(result.booking.tickets).toHaveLength(2);
      expect(store.outbox).toHaveLength(1);
      expect(await store.listTicketsByAccount('acc_1')).toHaveLength(2);
    });

    it('returns null and changes nothing when the booking is not in the expected state', async () => {
      await store.createBooking({ ...baseBooking, status: 'SELECTION' });
      expect(await store.payBookingWithTickets('bk_pay', 'PAYMENT_PENDING', {}, paidOutbox, [row(1)])).toBeNull();
      expect((await store.getBooking('bk_pay')).status).toBe('SELECTION');
      expect(store.outbox).toHaveLength(0);
      expect(store.tickets.size).toBe(0);
    });

    it('rolls the status, outbox and tickets back when issuing fails', async () => {
      await store.createBooking(baseBooking);
      jest.spyOn(store, 'mintTickets').mockRejectedValueOnce(new Error('disk full'));
      await expect(store.payBookingWithTickets('bk_pay', 'PAYMENT_PENDING', {}, paidOutbox, [row(1)])).rejects.toThrow(
        'disk full'
      );
      expect((await store.getBooking('bk_pay')).status).toBe('PAYMENT_PENDING');
      expect(store.outbox).toHaveLength(0);
      expect(await store.getActiveBookingByAdmission('adm_pay')).toMatchObject({ bookingId: 'bk_pay' });
    });
  });
});
