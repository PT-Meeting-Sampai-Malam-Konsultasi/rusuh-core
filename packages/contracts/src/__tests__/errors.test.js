const { ERROR_CODES, problem } = require('../errors');

describe('problem()', () => {
  it('builds a Problem body for a known code', () => {
    const body = problem('NIK_SEAT_TAKEN', 'NIK already holds 3 seats', { nikMasked: '3171****0001' });
    expect(body.status).toBe(409);
    expect(body.code).toBe('NIK_SEAT_TAKEN');
    expect(body.detail).toBe('NIK already holds 3 seats');
    expect(body.nikMasked).toBe('3171****0001');
  });

  it('falls back to 500 for an unknown code', () => {
    expect(problem('NOPE').status).toBe(500);
  });

  it('covers every repo error code', () => {
    const expected = [
      'UNAUTHORIZED',
      'ADMISSION_INVALID',
      'NOT_FOUND',
      'QUANTITY_OVER_RESERVATION',
      'DUPLICATE_NIK',
      'NIK_SEAT_TAKEN',
      'CATEGORY_SOLD_OUT',
      'BOOKING_NOT_HELD',
      'NOT_CANCELLABLE',
      'ATTENDEE_NOT_VALIDATED',
      'QUEUE_CLOSED',
      'MISSED',
      'EXPIRED',
      'NIK_INVALID',
      'WRONG_CODE',
      'CHALLENGE_EXPIRED',
      'CHALLENGE_LOCKED',
      'DUKCAPIL_UNAVAILABLE'
    ];
    expect(Object.keys(ERROR_CODES).sort()).toEqual(expected.sort());
  });
});
