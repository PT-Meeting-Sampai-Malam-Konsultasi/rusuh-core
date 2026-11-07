const {
  serverNow,
  presentEvent,
  presentCategory,
  availabilityOf,
  presentAttendee,
  presentBooking,
  presentTicket
} = require('../presenters');

const EVENT = {
  eventId: 'evt_1',
  name: 'Samudra',
  subtitle: 'Tur Gelombang 2026',
  format: 'Tour',
  venue: 'Stadion Utama GBK',
  venueShort: 'GBK',
  city: 'Jakarta',
  timezone: 'Asia/Jakarta',
  startsAt: '2026-12-12T12:00:00Z',
  doorsOpenAt: '2026-12-12T10:00:00Z',
  saleOpensAt: '2026-11-14T03:00:00Z',
  waitingRoomOpensAt: '2026-11-14T02:30:00Z',
  saleEndsAt: '2026-11-20T16:59:59Z',
  state: 'on_sale',
  priceFrom: { amount: 1500000, currency: 'IDR' },
  capacity: 50000,
  soldOutAt: null,
  imageUrl: 'https://cdn.example.com/smudra.jpg'
};

describe('presenters (public API shapes)', () => {
  it('serverNow returns an ISO timestamp', () => {
    expect(serverNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('presentEvent maps all fields when present', () => {
    expect(presentEvent(EVENT)).toMatchObject({
      eventId: 'evt_1',
      name: 'Samudra',
      subtitle: 'Tur Gelombang 2026',
      format: 'Tour',
      venue: 'Stadion Utama GBK',
      venueShort: 'GBK',
      city: 'Jakarta',
      timezone: 'Asia/Jakarta',
      state: 'on_sale',
      capacity: 50000,
      imageUrl: 'https://cdn.example.com/smudra.jpg'
    });
  });

  it('presentEvent nulls the optional fields when missing', () => {
    const presented = presentEvent({ eventId: 'evt_1', name: 'X', venue: 'V', state: 'draft' });
    expect(presented).toMatchObject({
      subtitle: null,
      format: null,
      venueShort: null,
      city: null,
      timezone: 'Asia/Jakarta',
      doorsOpenAt: null,
      saleOpensAt: null,
      waitingRoomOpensAt: null,
      saleEndsAt: null,
      priceFrom: null,
      capacity: null,
      soldOutAt: null,
      imageUrl: null
    });
  });

  it('availabilityOf covers sold_out / almost_gone / available + the threshold override', () => {
    expect(availabilityOf(0, 100)).toBe('sold_out');
    expect(availabilityOf(-1, 100)).toBe('sold_out');
    // Default threshold = min(10% of total, 100): total 1000 -> 100.
    expect(availabilityOf(100, 1000)).toBe('almost_gone');
    expect(availabilityOf(101, 1000)).toBe('available');
    expect(availabilityOf(5, 100)).toBe('almost_gone');
    expect(availabilityOf(50, 100)).toBe('available');
    // Explicit threshold wins over the default.
    expect(availabilityOf(5, 1000, 3)).toBe('available');
    expect(availabilityOf(3, 1000, 3)).toBe('almost_gone');
  });

  it('presentCategory maps the price and availability', () => {
    const category = {
      categoryId: 'cat_1',
      name: 'Festival B',
      description: 'Standing',
      seating: 'Festival',
      entryGate: 'Gate A',
      price: 1500000,
      total: 1000
    };
    expect(presentCategory(category, 500)).toMatchObject({
      categoryId: 'cat_1',
      name: 'Festival B',
      description: 'Standing',
      seating: 'Festival',
      entryGate: 'Gate A',
      price: { amount: 1500000, currency: 'IDR' },
      availability: 'available',
      available: 500
    });
    expect(presentCategory(category, 0)).toMatchObject({ availability: 'sold_out', available: 0 });
    const minimal = presentCategory({ categoryId: 'cat_2', name: 'X', seating: 'S', price: 100 }, 10);
    expect(minimal).toMatchObject({ description: null, entryGate: null });
  });

  it('presentAttendee and presentTicket map their rows', () => {
    expect(
      presentAttendee({
        categoryId: 'cat_1',
        categoryName: 'Festival B',
        fullName: 'Edy',
        nikMasked: '3171 •••• •••• 0001'
      })
    ).toEqual({
      categoryId: 'cat_1',
      categoryName: 'Festival B',
      fullName: 'Edy',
      nikMasked: '3171 •••• •••• 0001'
    });
    const ticket = {
      ticketId: 'tk_1',
      ticketCode: 'SMD-FB-00001',
      bookingId: 'bk_1',
      eventId: 'evt_1',
      categoryId: 'cat_1',
      categoryName: 'Festival B',
      seating: 'Festival',
      entryGate: 'Gate A',
      holderName: 'Edy',
      nikMasked: '3171 •••• •••• 0001',
      qrPayload: 'RSH1.SMD-FB-00001.abc',
      issuedAt: '2026-11-07T10:00:00.000Z'
    };
    expect(presentTicket(ticket)).toEqual(ticket);
  });

  it('presentBooking maps attendees/tickets and hides the expiry once PAID', () => {
    const booking = {
      bookingId: 'bk_1',
      eventId: 'evt_1',
      status: 'SELECTION',
      price: { total: { amount: 100, currency: 'IDR' } },
      orderCode: 'RSH-26-000001',
      attendees: [
        { categoryId: 'cat_1', categoryName: 'Festival B', fullName: 'Edy', nikMasked: '3171 •••• •••• 0001' }
      ],
      tickets: [],
      expiresAt: '2026-11-07T10:05:00.000Z',
      paymentExpiresAt: null,
      refundRequired: false,
      paidAt: null,
      paymentMethod: null,
      createdAt: '2026-11-07T10:00:00.000Z'
    };
    const presented = presentBooking(booking);
    expect(presented.expiresAt).toBe('2026-11-07T10:05:00.000Z');
    expect(presented.attendees).toHaveLength(1);
    expect(presented.tickets).toEqual([]);
    expect(presented.refundRequired).toBe(false);
    expect(presented.serverNow).toBeDefined();

    const paid = presentBooking({
      ...booking,
      status: 'PAID',
      paymentExpiresAt: '2026-11-07T10:15:00.000Z',
      paidAt: '2026-11-07T10:10:00.000Z',
      paymentMethod: 'gopay',
      refundRequired: true
    });
    expect(paid.expiresAt).toBeNull();
    expect(paid.paidAt).toBe('2026-11-07T10:10:00.000Z');
    expect(paid.paymentMethod).toBe('gopay');
    expect(paid.refundRequired).toBe(true);
  });

  it('presentBooking tolerates missing attendees/tickets and prefers paymentExpiresAt', () => {
    const presented = presentBooking({
      bookingId: 'bk_1',
      eventId: 'evt_1',
      status: 'PAYMENT_PENDING',
      price: {},
      orderCode: 'RSH-26-000001',
      expiresAt: '2026-11-07T10:05:00.000Z',
      paymentExpiresAt: '2026-11-07T10:15:00.000Z',
      createdAt: '2026-11-07T10:00:00.000Z'
    });
    expect(presented.attendees).toEqual([]);
    expect(presented.tickets).toEqual([]);
    expect(presented.expiresAt).toBe('2026-11-07T10:15:00.000Z');
  });
});
