const { apiError } = require('@/application/shared/api-error');

/**
 * Express middleware that requires a valid account JWT (Bearer).
 * Verifies locally via @rusuh/auth (Ed25519) + the jti denylist (Valkey).
 * Fail-closed: when the denylist cannot be reached the request is rejected
 * with 503 retryable (LLD-01 §6.3).
 *
 * On success attaches `request.account = { accountId, jti, exp }`.
 *
 * @param {object} options - Middleware dependencies.
 * @param {object} options.tokens - Token service (verifyAccessToken).
 * @param {object} options.denylist - jti denylist (isDenied).
 * @returns {Function} Express middleware.
 */
function requireAccountToken({ tokens, denylist }) {
  return async (request, _response, next) => {
    try {
      const header = request.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      if (!token) throw apiError('UNAUTHORIZED', 'Token akun tidak ditemukan');

      let payload;
      try {
        payload = await tokens.verifyAccessToken(token, async (jti) => denylist.isDenied(jti));
      } catch (error) {
        if (error.code === 'DENYLIST_UNAVAILABLE') {
          throw apiError('SERVICE_UNAVAILABLE', 'Layanan verifikasi token tidak tersedia, coba lagi');
        }
        throw apiError('UNAUTHORIZED', 'Token akun tidak valid');
      }

      request.account = { accountId: payload.sub, jti: payload.jti, exp: payload.exp };
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { requireAccountToken };
