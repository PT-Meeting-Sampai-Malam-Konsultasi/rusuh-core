const Boom = require('@hapi/boom');
const { apiError, toProblem } = require('../api-error');

describe('api-error', () => {
  it('apiError carries a repo code and the right HTTP status', () => {
    const error = apiError('WRONG_CODE', 'Kode salah', { attemptsLeft: 3 });
    expect(error.output.statusCode).toBe(409);
    expect(error.data).toEqual({ code: 'WRONG_CODE', attemptsLeft: 3 });
    const { status, body } = toProblem(error);
    expect(status).toBe(409);
    expect(body).toEqual(
      expect.objectContaining({ code: 'WRONG_CODE', status: 409, detail: 'Kode salah', attemptsLeft: 3 })
    );
  });

  it('apiError maps a generic code to its status', () => {
    const error = apiError('TOO_MANY_REQUESTS', 'Tunggu dulu');
    expect(error.output.statusCode).toBe(429);
    const { status, body } = toProblem(error);
    expect(status).toBe(429);
    expect(body.status).toBe(429);
    expect(body.code).toBe('TOO_MANY_REQUESTS');
    expect(body.title).toBe('Too Many Requests');
  });

  it('toProblem renders a plain Boom error as Problem JSON', () => {
    const { status, body } = toProblem(Boom.notFound('Nope'), 'trace-1');
    expect(status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.traceId).toBe('trace-1');
  });

  it('toProblem renders a non-Boom error as 500', () => {
    const { status, body } = toProblem(new Error('boom'));
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});
