const { ApiError } = require('@/domain/errors');

/**
 * Admin-only guard (LLD-05 §2). The account JWT (email+OTP, auth-module)
 * identifies the account; the ROLE is read from the database, never from
 * a JWT claim (Q42 claim discipline: sub/iat/exp/jti/kid only).
 *
 * @param {object} options - Guard dependencies.
 * @param {object} options.auth - Token verifier { verify(token) }.
 * @param {object} options.store - Store with getUserById(accountId).
 * @returns {Function} Express middleware setting request.admin.
 */
function createRequireAdmin({ auth, store } = {}) {
  if (!auth || typeof auth.verify !== 'function') throw new Error('requireAdmin needs auth.verify');
  if (!store || typeof store.getUserById !== 'function') throw new Error('requireAdmin needs store.getUserById');

  return async (request, _response, next) => {
    try {
      const header = request.headers.authorization || '';
      const match = /^Bearer\s+(.+)$/.exec(header);
      if (!match) throw new ApiError('UNAUTHORIZED', 'Missing bearer token');
      const payload = await auth.verify(match[1]);
      const user = await store.getUserById(payload.sub);
      if (!user || user.role !== 'admin') {
        throw new ApiError('FORBIDDEN', 'Admin role required');
      }
      request.admin = { accountId: payload.sub, email: user.email, role: user.role };
      next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      return next(new ApiError('UNAUTHORIZED', 'Invalid account token'));
    }
  };
}

module.exports = { createRequireAdmin };
