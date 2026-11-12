const { ApiError } = require('@/domain/errors');

/**
 * Admin-only guard (LLD-05 §2). The account JWT (email+OTP, auth-module)
 * identifies the account; the ROLE is read from the database, never from
 * a JWT claim (Q42 claim discipline: sub/iat/exp/jti/kid only).
 *
 * @param {object} options - Guard dependencies.
 * @param {object} options.auth - Token verifier { verify(token) }.
 * @param {object} options.accounts - Auth account client with getAccount(accountId).
 * @returns {Function} Express middleware setting request.admin.
 */
function createRequireAdmin({ auth, accounts } = {}) {
  if (!auth || typeof auth.verify !== 'function') throw new Error('requireAdmin needs auth.verify');
  if (!accounts || typeof accounts.getAccount !== 'function') throw new Error('requireAdmin needs accounts.getAccount');

  return async (request, _response, next) => {
    try {
      const header = request.headers.authorization || '';
      const match = /^Bearer\s+(.+)$/.exec(header);
      if (!match) throw new ApiError('UNAUTHORIZED', 'Missing bearer token');
      const payload = await auth.verify(match[1]);
      const account = await accounts.getAccount(payload.sub);
      if (!account || account.role !== 'admin') {
        throw new ApiError('FORBIDDEN', 'Admin role required');
      }
      request.admin = { accountId: account.id, email: account.email, role: account.role };
      next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      return next(new ApiError('UNAUTHORIZED', 'Invalid account token'));
    }
  };
}

module.exports = { createRequireAdmin };
