const { generateBookingId, generateTicketId, generateOrderCode, ticketCode, qrPayload } = require('@/lib/ids');

describe('ids', () => {
  it('generates unique time-ordered booking ids', () => {
    const a = generateBookingId();
    const b = generateBookingId();
    expect(a).toMatch(/^bk_[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(a).not.toBe(b);
  });

  it('generates unique ticket ids', () => {
    expect(generateTicketId()).toMatch(/^tk_[0-9A-HJKMNP-TV-Z]{20}$/);
  });

  it('generates a public order code (RSH-YY-NNNNNN)', () => {
    expect(generateOrderCode()).toMatch(/^RSH-\d{2}-\d{6}$/);
  });

  it('builds the public ticket code (D19)', () => {
    expect(ticketCode('EVT_GBK', 'VIP', 27)).toBe('EVT_GBK-VIP-00027');
  });

  it('builds a signed QR payload carrying the ticket code (Q22)', () => {
    const payload = qrPayload('SMD-FB-04827', 'qr-key');
    expect(payload.startsWith('RSH1.SMD-FB-04827.')).toBe(true);
    const parts = payload.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);
    // Same code + same key = same signature (deterministic HMAC).
    expect(qrPayload('SMD-FB-04827', 'qr-key')).toBe(payload);
    expect(qrPayload('SMD-FB-04827', 'other-key')).not.toBe(payload);
  });
});
