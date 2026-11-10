const { apiError } = require('@/domain/errors');

/**
 * Creates middleware requiring a valid account JWT + a server-side role
 * (LLD-05 §2: role is read from the database per request, never from JWT
 * claims). The officer endpoints are low traffic, so the per-request role
 * lookup is acceptable (unlike the transaction hot path).
 *
 * @param {object} options
 * @param {Function} options.verifyToken - Async (token) => JWT payload.
 * @param {Function} options.roleResolver - Async (accountId) => role or null.
 * @param {string} [options.requiredRole] - Default 'officer'.
 * @returns {Function} Express middleware; sets request.account = { id, role, jti }.
 */
function createRequireRole({ verifyToken, roleResolver, requiredRole = 'officer' } = {}) {
  if (typeof verifyToken !== 'function') throw new Error('createRequireRole requires verifyToken');
  if (typeof roleResolver !== 'function') throw new Error('createRequireRole requires roleResolver');

  return async (request, _response, next) => {
    try {
      const header = request.headers.authorization || '';
      const match = /^Bearer\s+(.+)$/.exec(header);
      if (!match) throw apiError('UNAUTHORIZED', 'Missing bearer token');
      const payload = await verifyToken(match[1]);
      const role = await roleResolver(payload.sub);
      if (role !== requiredRole) {
        throw apiError('FORBIDDEN', `Role ${role || 'none'} may not call officer endpoints`);
      }
      request.account = { id: payload.sub, role, jti: payload.jti };
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { createRequireRole };
