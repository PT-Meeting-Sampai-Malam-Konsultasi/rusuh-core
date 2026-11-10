const { apiError } = require('@/application/shared/api-error');

/**
 * Service-key auth for internal endpoints (core-module -> auth, the same
 * x-service-key convention payment-module and core-module already share).
 * The shared key comes from config (SERVICE_KEY); when it is not set the
 * endpoint rejects everything (fail-closed).
 *
 * @param {object} deps
 * @param {string} [deps.serviceKey] - Shared service credential.
 * @returns {Function} Express middleware.
 */
function requireServiceKey({ serviceKey } = {}) {
  return (request, _response, next) => {
    const presented = request.headers['x-service-key'];
    if (!serviceKey || !presented || presented !== serviceKey) {
      next(apiError('UNAUTHORIZED', 'Kredensial layanan tidak valid'));
      return;
    }
    next();
  };
}

module.exports = { requireServiceKey };
