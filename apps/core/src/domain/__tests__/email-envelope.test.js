const {
  formatEventDate,
  formatWibClock,
  formatDateTime,
  formatIdr,
  paymentMethodLabel,
  buildTicketEnvelope,
  buildExpiredEnvelope,
  buildRefundFlaggedEnvelope
} = require('@/domain/email-envelope');

// 2026-12-12T12:00:00Z = Saturday 19.00 WIB (rusuh-web#46 sample date).
const STARTS_AT = new Date('2026-12-12T12:00:00Z');
const ACCOUNT = { email: 'buyer@example.com', locale: 'id' };
const BOOKING = {
  bookingId: 'bk_01JB',
  eventId: 'evt_2026_gbk',
  orderCode: 'RSH-GBK-4XK2Q9',
  paymentExpiresAt: '2026-12-05T12:00:00.000Z',
  paidAt: '2026-12-05T11:42:00.000Z',
  paymentMethod: 'bank_transfer',
  price: { total: { amount: 3015000, currency: 'IDR' } }
};
const EVENT = {
  name: 'Rusuh Fest 2026',
  subtitle: 'Panggung Utama',
  venue: 'Gelora Bung Karno',
  startsAt: STARTS_AT.toISOString(),
  doorsOpenAt: '2026-12-12T10:00:00Z'
};
const TICKETS = [
  {
    ticketCode: 'RSH-GBK-FB-000001',
    categoryName: 'Festival B',
    holderName: 'Edy Supardi',
    nikMasked: '3171 •••• •••• 0001',
    entryGate: 'Timur'
  },
  {
    ticketCode: 'RSH-GBK-FB-000002',
    categoryName: 'Festival B',
    holderName: 'Rina',
    nikMasked: '3172 •••• •••• 0002',
    entryGate: ''
  }
];

describe('e-mail formatting (rusuh-web#46)', () => {
  it('formats dates, clocks and money per language', () => {
    expect(formatEventDate(STARTS_AT, 'id')).toBe('Sab, 12 Des 2026');
    expect(formatEventDate(STARTS_AT, 'en')).toBe('Sat, 12 Dec 2026');
    expect(formatWibClock(STARTS_AT, 'id')).toBe('19.00 WIB');
    expect(formatWibClock(STARTS_AT, 'en')).toBe('7.00 pm WIB');
    expect(formatIdr(3015000, 'id')).toBe('Rp 3.015.000');
    expect(formatIdr(3015000, 'en')).toBe('Rp 3,015,000');
    expect(formatDateTime('2026-12-05T11:42:00.000Z', 'id')).toBe('Sab, 5 Des 2026, 18.42 WIB');
  });

  it('labels known Midtrans payment types and humanizes unknown ones', () => {
    expect(paymentMethodLabel('bank_transfer', 'id')).toBe('Transfer bank');
    expect(paymentMethodLabel('bank_transfer', 'en')).toBe('Bank transfer');
    expect(paymentMethodLabel('qris', 'en')).toBe('QRIS');
    expect(paymentMethodLabel('bca_va', 'id')).toBe('bca va');
    expect(paymentMethodLabel(null, 'id')).toBe('Tidak tercatat');
  });
});

describe('buildTicketEnvelope', () => {
  it('builds the EMAIL_TICKET envelope with pre-formatted variables', () => {
    const envelope = buildTicketEnvelope({
      account: ACCOUNT,
      booking: BOOKING,
      event: EVENT,
      tickets: TICKETS,
      links: {
        ticketUrl: 'https://web.test/bookings/bk_01JB',
        downloadAllUrl: 'https://web.test/bookings/bk_01JB?download=all'
      }
    });
    expect(envelope).toEqual({
      type: 'EMAIL_TICKET',
      to: 'buyer@example.com',
      locale: 'id',
      booking_id: 'bk_01JB',
      variables: {
        event_name: 'Rusuh Fest 2026',
        event_subtitle: 'Panggung Utama',
        event_date: 'Sab, 12 Des 2026',
        event_time: '19.00 WIB',
        venue: 'Gelora Bung Karno',
        doors_open_at: '17.00 WIB',
        order_code: 'RSH-GBK-4XK2Q9',
        total: 'Rp 3.015.000',
        payment_method: 'Transfer bank',
        paid_at: 'Sab, 5 Des 2026, 18.42 WIB',
        count: 2,
        ticket_url: 'https://web.test/bookings/bk_01JB',
        download_all_url: 'https://web.test/bookings/bk_01JB?download=all',
        email: 'buyer@example.com',
        tickets: [
          {
            index: 1,
            category: 'Festival B',
            holder_name: 'Edy Supardi',
            nik_masked: '3171 •••• •••• 0001',
            ticket_code: 'RSH-GBK-FB-000001',
            gate: 'Timur'
          },
          {
            index: 2,
            category: 'Festival B',
            holder_name: 'Rina',
            nik_masked: '3172 •••• •••• 0002',
            ticket_code: 'RSH-GBK-FB-000002',
            gate: ''
          }
        ]
      }
    });
  });

  it('defaults the locale to id', () => {
    const envelope = buildTicketEnvelope({
      account: { email: 'buyer@example.com' },
      booking: BOOKING,
      event: EVENT,
      tickets: TICKETS,
      links: { ticketUrl: 'u', downloadAllUrl: 'd' }
    });
    expect(envelope.locale).toBe('id');
    expect(envelope.variables.event_date).toBe('Sab, 12 Des 2026');
  });
});

describe('buildExpiredEnvelope', () => {
  it('builds the EMAIL_EXPIRED envelope with the queue-again link', () => {
    const envelope = buildExpiredEnvelope({
      account: ACCOUNT,
      booking: BOOKING,
      event: EVENT,
      links: { eventUrl: 'https://web.test/queue?event=evt_2026_gbk' }
    });
    expect(envelope).toEqual({
      type: 'EMAIL_EXPIRED',
      to: 'buyer@example.com',
      locale: 'id',
      booking_id: 'bk_01JB',
      variables: {
        event_name: 'Rusuh Fest 2026',
        order_code: 'RSH-GBK-4XK2Q9',
        total: 'Rp 3.015.000',
        deadline: 'Sab, 5 Des 2026, 19.00 WIB',
        email: 'buyer@example.com',
        event_url: 'https://web.test/queue?event=evt_2026_gbk'
      }
    });
  });
});

describe('buildRefundFlaggedEnvelope', () => {
  it('builds the EMAIL_REFUND_FLAGGED envelope (ADR-0009 late payment)', () => {
    const envelope = buildRefundFlaggedEnvelope({
      account: { email: 'buyer@example.com', locale: 'en' },
      booking: BOOKING,
      event: EVENT,
      transactionId: 'txn-settle-99',
      paymentType: 'gopay',
      paidAt: '2026-12-05T13:00:00.000Z',
      refundWindowLabel: { id: '14 hari kerja', en: '14 business days' }
    });
    expect(envelope).toEqual({
      type: 'EMAIL_REFUND_FLAGGED',
      to: 'buyer@example.com',
      locale: 'en',
      booking_id: 'bk_01JB',
      variables: {
        event_name: 'Rusuh Fest 2026',
        order_code: 'RSH-GBK-4XK2Q9',
        total: 'Rp 3,015,000',
        payment_method: 'GoPay',
        paid_at: 'Sat, 5 Dec 2026, 8.00 pm WIB',
        deadline: 'Sat, 5 Dec 2026, 7.00 pm WIB',
        refund_window: '14 business days',
        transaction_id: 'txn-settle-99',
        email: 'buyer@example.com'
      }
    });
  });
});
