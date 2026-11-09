const { OFFICER_ERROR_CODES, isKnownCode, officerProblem, apiError } = require('../errors');

describe('isKnownCode', () => {
  it('knows officer codes', () => {
    expect(isKnownCode('TICKET_NOT_FOUND')).toBe(true);
    expect(isKnownCode('SERVICE_UNAVAILABLE')).toBe(true);
  });

  it('knows repo codes from @rusuh/contracts', () => {
    expect(isKnownCode('NOT_FOUND')).toBe(true);
    expect(isKnownCode('UNAUTHORIZED')).toBe(true);
  });

  it('rejects unknown, empty and missing codes', () => {
    expect(isKnownCode('NOPE_NOT_A_CODE')).toBe(false);
    expect(isKnownCode('')).toBe(false);
    expect(isKnownCode(null)).toBe(false);
    expect(isKnownCode(undefined)).toBe(false);
  });
});

describe('officerProblem', () => {
  it('renders an officer code with detail and extra members', () => {
    const body = officerProblem('TICKET_NOT_FOUND', 'Ticket tk_1 was not found', { ticketId: 'tk_1' });
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Ticket not found',
      status: 404,
      code: 'TICKET_NOT_FOUND',
      detail: 'Ticket tk_1 was not found',
      ticketId: 'tk_1'
    });
  });

  it('omits detail when none is given', () => {
    const body = officerProblem('FORBIDDEN');
    expect(body).not.toHaveProperty('detail');
    expect(body.status).toBe(403);
    expect(body.title).toBe('Forbidden');
  });

  it('delegates repo codes to @rusuh/contracts problem()', () => {
    const body = officerProblem('NOT_FOUND', 'Event evt_1 was not found');
    expect(body.code).toBe('NOT_FOUND');
    expect(body.status).toBe(404);
    expect(body.detail).toBe('Event evt_1 was not found');
  });
});

describe('apiError', () => {
  it('carries code, status and data.code', () => {
    const error = apiError('TICKET_NOT_VALID', 'Ticket is only valid on 2026-11-14');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('TICKET_NOT_VALID');
    expect(error.status).toBe(409);
    expect(error.data).toEqual({ code: 'TICKET_NOT_VALID' });
    expect(error.message).toBe('Ticket is only valid on 2026-11-14');
  });

  it('falls back to the Problem title when no detail is given', () => {
    const error = apiError('SERVICE_UNAVAILABLE');
    expect(error.message).toBe('Service unavailable');
    expect(error.status).toBe(503);
  });

  it('merges extra members into data', () => {
    const error = apiError('FORBIDDEN', 'Role customer may not call officer endpoints', { role: 'customer' });
    expect(error.data).toEqual({ code: 'FORBIDDEN', role: 'customer' });
  });

  it('exposes the officer error code table', () => {
    expect(OFFICER_ERROR_CODES.TICKET_ALREADY_USED).toEqual({ status: 409, title: 'Ticket already used' });
  });
});
