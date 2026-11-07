const { ticketIdParam, eventIdParam, scanBody, attendeesQuery, validate } = require('../officer.validation');

describe('validate', () => {
  it('returns the validated value with defaults applied', () => {
    expect(validate(attendeesQuery, {})).toEqual({ page: 1, limit: 50 });
    expect(validate(attendeesQuery, { page: '2', limit: '10' })).toEqual({ page: 2, limit: 10 });
    expect(validate(ticketIdParam, { ticketId: 'tk_1' })).toEqual({ ticketId: 'tk_1' });
    expect(validate(eventIdParam, { eventId: 'evt_1' })).toEqual({ eventId: 'evt_1' });
    expect(validate(scanBody, {})).toEqual({});
    expect(validate(scanBody, { gate: 'Gerbang 5' })).toEqual({ gate: 'Gerbang 5' });
  });

  it('throws a 400 Boom error with code VALIDATION_FAILED on invalid input', () => {
    let caught;
    try {
      validate(ticketIdParam, { ticketId: '' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.isBoom).toBe(true);
    expect(caught.output.statusCode).toBe(400);
    expect(caught.data).toEqual({ code: 'VALIDATION_FAILED' });
    expect(caught.message).toContain('Validation failed');
  });

  it('collects all validation errors (abortEarly: false)', () => {
    let caught;
    try {
      validate(attendeesQuery, { page: 0, limit: 101 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toContain('page');
    expect(caught.message).toContain('limit');
  });
});
