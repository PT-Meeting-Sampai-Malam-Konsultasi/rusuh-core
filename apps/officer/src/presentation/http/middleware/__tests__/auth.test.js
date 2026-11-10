const { apiError } = require('@/domain/errors');
const { createRequireRole } = require('../auth');

describe('createRequireRole', () => {
  const verifyToken = async (token) => {
    if (token === 'officer-token') return { sub: 'acc_officer_1', jti: 'jti-1' };
    if (token === 'customer-token') return { sub: 'acc_customer_1', jti: 'jti-2' };
    throw apiError('UNAUTHORIZED', 'Bad signature');
  };
  const roleResolver = async (accountId) => (accountId === 'acc_officer_1' ? 'officer' : 'customer');

  const run = (middleware, headers) =>
    new Promise((resolve) => {
      const request = { headers, account: undefined };
      const next = (error) => resolve({ error, account: request.account });
      middleware(request, {}, next);
    });

  it('attaches the account and calls next for an officer', async () => {
    const middleware = createRequireRole({ verifyToken, roleResolver });
    const { error, account } = await run(middleware, { authorization: 'Bearer officer-token' });
    expect(error).toBeUndefined();
    expect(account).toEqual({ id: 'acc_officer_1', role: 'officer', jti: 'jti-1' });
  });

  it('rejects a missing bearer token with 401', async () => {
    const middleware = createRequireRole({ verifyToken, roleResolver });
    const { error } = await run(middleware, {});
    expect(error.data.code).toBe('UNAUTHORIZED');
  });

  it('rejects a customer with 403 FORBIDDEN', async () => {
    const middleware = createRequireRole({ verifyToken, roleResolver });
    const { error } = await run(middleware, { authorization: 'Bearer customer-token' });
    expect(error.data.code).toBe('FORBIDDEN');
  });

  it('rejects an invalid token with 401', async () => {
    const middleware = createRequireRole({ verifyToken, roleResolver });
    const { error } = await run(middleware, { authorization: 'Bearer nope' });
    expect(error.data.code).toBe('UNAUTHORIZED');
  });
});
