const constants = require('../constants');

describe('constants', () => {
  it('payment TTL is 10 minutes (BR-05)', () => {
    expect(constants.PAYMENT_TTL_MS).toBe(10 * 60 * 1000);
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
