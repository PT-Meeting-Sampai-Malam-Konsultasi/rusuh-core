const crypto = require('crypto');
const Boom = require('@hapi/boom');

/**
 * Creates the service-to-service auth middleware for /v1/internal/* routes.
 * Only the shared credential in `x-service-key` is accepted; account JWTs are
 * never looked at. Fail-closed: with no configured secret every request is
 * rejected.
 *
 * @param {object} options - Middleware options.
 * @param {string} [options.serviceKey] - Shared service credential.
 * @returns {Function} Express middleware.
 */
function createRequireServiceKey({ serviceKey } = {}) {
  const expected = serviceKey ? Buffer.from(serviceKey, 'utf8') : null;

  return (request, _response, next) => {
    const presented = request.headers['x-service-key'];
    if (!expected || typeof presented !== 'string' || presented.length === 0) {
      next(Boom.unauthorized('Missing or invalid service credential'));
      return;
    }
    const candidate = Buffer.from(presented, 'utf8');
    // timingSafeEqual throws on unequal lengths, so a length mismatch is rejected first.
    if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
      next(Boom.unauthorized('Missing or invalid service credential'));
      return;
    }
    next();
  };
}

module.exports = { createRequireServiceKey };
