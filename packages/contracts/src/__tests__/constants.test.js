const constants = require('../constants');

describe('constants', () => {
  it('admission TTL is 16 minutes (60s claim + 5 min detail + 10 min payment)', () => {
    expect(constants.ADMISSION_TOKEN_TTL_MS).toBe(16 * 60 * 1000);
    expect(constants.CLAIM_WINDOW_MS + constants.DETAIL_TTL_MS + constants.PAYMENT_TTL_MS).toBe(16 * 60 * 1000);
  });

  it('max 3 seats per NIK per event (BR-01, ADR-0024)', () => {
    expect(constants.MAX_SEATS_PER_NIK).toBe(3);
    expect(constants.MAX_TICKETS_PER_ORDER).toBe(3);
  });

  it('refresh is 7 days (ADR-0025), access 15 minutes', () => {
    expect(constants.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(constants.ACCESS_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
  });
});
