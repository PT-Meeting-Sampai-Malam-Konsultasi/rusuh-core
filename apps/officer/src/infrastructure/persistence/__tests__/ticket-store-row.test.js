const { rowToTicket } = require('../ticket-store');

describe('rowToTicket', () => {
  const fullRow = {
    id: 'tk_01JB2YBA1',
    public_code: 'SMD-FB-04827',
    booking_id: 'bk_01JB2Y6Z8Q',
    event_id: 'evt_2026_gbk',
    event_name: 'Rusuh Festival 2026',
    event_date: '2026-11-14T00:00:00.000Z',
    category_id: 'cat_festival_b',
    category_name: 'Festival B',
    gate: 'Gerbang 5',
    seating: 'standing',
    holder_name: 'Rina Wulandari',
    nik_masked: '3171 •••• •••• 0001',
    nik_cipher: 'iv:data:tag',
    status: 'used',
    used_at: '2026-11-14T10:46:00.000Z',
    used_by: 'acc_officer_1',
    issued_at: '2026-11-14T10:00:00.000Z'
  };

  it('maps a full row to a ticket record', () => {
    const ticket = rowToTicket(fullRow);
    expect(ticket).toEqual({
      id: 'tk_01JB2YBA1',
      publicCode: 'SMD-FB-04827',
      bookingId: 'bk_01JB2Y6Z8Q',
      eventId: 'evt_2026_gbk',
      eventName: 'Rusuh Festival 2026',
      eventDate: '2026-11-14',
      categoryId: 'cat_festival_b',
      categoryName: 'Festival B',
      gate: 'Gerbang 5',
      seating: 'standing',
      holderName: 'Rina Wulandari',
      nikMasked: '3171 •••• •••• 0001',
      nikCipher: 'iv:data:tag',
      status: 'used',
      usedAt: '2026-11-14T10:46:00.000Z',
      usedBy: 'acc_officer_1',
      issuedAt: '2026-11-14T10:00:00.000Z'
    });
  });

  it('maps missing/nullable columns to null', () => {
    const ticket = rowToTicket({
      ...fullRow,
      event_name: null,
      event_date: null,
      gate: null,
      seating: null,
      used_at: null,
      used_by: null,
      issued_at: null
    });
    expect(ticket.eventName).toBeNull();
    expect(ticket.eventDate).toBeNull();
    expect(ticket.gate).toBeNull();
    expect(ticket.seating).toBeNull();
    expect(ticket.usedAt).toBeNull();
    expect(ticket.usedBy).toBeNull();
    expect(ticket.issuedAt).toBeNull();
  });

  it('truncates a date-only event_date to YYYY-MM-DD', () => {
    const ticket = rowToTicket({ ...fullRow, event_date: '2026-11-14' });
    expect(ticket.eventDate).toBe('2026-11-14');
  });
});
