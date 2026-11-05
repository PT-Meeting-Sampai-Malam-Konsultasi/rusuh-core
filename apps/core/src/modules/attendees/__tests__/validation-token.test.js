const { issueValidationToken, verifyValidationToken } = require('@/modules/attendees/validation-token');

describe('validationToken', () => {
  const key = Buffer.from('b'.repeat(32));
  const payload = {
    eventId: 'evt_2026_gbk',
    fieldIndex: 0,
    fullName: 'Edy Supardi',
    nik: '3171010101900001',
    nikHmac: 'hmac-1',
    nikMasked: '3171 •••• •••• 0001'
  };

  it('issues a token that verifies back to the payload', () => {
    const { validationToken, expiresAt } = issueValidationToken(payload, key);
    expect(validationToken.startsWith('av_')).toBe(true);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    const verified = verifyValidationToken(validationToken, key);
    expect(verified).toMatchObject(payload);
  });

  it('returns null for a token verified against a different event', () => {
    const { validationToken } = issueValidationToken(payload, key);
    const verified = verifyValidationToken(validationToken, key);
    // The token itself carries the event; the caller checks eventId.
    expect(verified.eventId).toBe('evt_2026_gbk');
    expect(verified.eventId).not.toBe('evt_other');
  });

  it('returns null for an expired token', () => {
    const { validationToken } = issueValidationToken(payload, key);
    // Verify 10 minutes later (TTL is 5 min).
    expect(verifyValidationToken(validationToken, key, Date.now() + 10 * 60 * 1000)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(verifyValidationToken('av_not-base64!!', key)).toBeNull();
    expect(verifyValidationToken('not-av-prefixed', key)).toBeNull();
    expect(verifyValidationToken(null, key)).toBeNull();
  });

  it('returns null for a token encrypted with a different key', () => {
    const { validationToken } = issueValidationToken(payload, key);
    expect(verifyValidationToken(validationToken, Buffer.from('c'.repeat(32)))).toBeNull();
  });
});
