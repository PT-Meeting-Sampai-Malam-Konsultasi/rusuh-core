const crypto = require('crypto');

/**
 * Correlation-ID middleware (two levels: request id + booking id when present).
 * Reads `X-Correlation-Id` or generates one; echoes it on the response.
 */
function correlationMiddleware(request, response, next) {
  const correlationId = request.headers['x-correlation-id'] || crypto.randomUUID();
  request.correlationId = correlationId;
  response.setHeader('X-Correlation-Id', correlationId);
  next();
}

module.exports = { correlationMiddleware };
