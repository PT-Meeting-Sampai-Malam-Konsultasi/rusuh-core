const { getRequestContext, resolveRequestId, runWithRequestContext } = require('./request-context');
const { serializeError } = require('./redaction');

const DEFAULT_SKIP_PATHS = Object.freeze(['/sys/ping', '/health/live', '/health/ready', '/readyz']);

/**
 * Creates Express middleware for request correlation and one terminal event.
 * Expected client errors remain completed requests; only 5xx responses fail.
 *
 * @param {object} options - HTTP observability dependencies.
 * @param {object} options.logger - Structured logger.
 * @param {string[]} [options.skipPaths] - Paths excluded from terminal logs.
 * @param {() => string} [options.uuid] - UUID generator for tests.
 * @param {() => bigint} [options.now] - Monotonic clock for tests.
 * @returns {Function} Express middleware.
 */
function createRequestContextMiddleware({
  logger,
  skipPaths = DEFAULT_SKIP_PATHS,
  uuid,
  now = process.hrtime.bigint
} = {}) {
  if (!logger) throw new Error('createRequestContextMiddleware requires logger');
  const skipped = new Set(skipPaths);
  return (request, response, next) => {
    const requestId = resolveRequestId(request.headers, uuid);
    const start = now();
    const context = { requestId };
    request.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);

    response.once('finish', () => {
      if (skipped.has(request.path)) return;
      const durationMs = Number(now() - start) / 1e6;
      const { statusCode } = response;
      const route = request.route?.path;
      const fields = {
        requestId,
        'http.request.method': request.method,
        'url.path': route || request.path,
        'http.response.status_code': statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000
      };
      if (statusCode >= 500) {
        logger.error('http.request.failed', {
          ...fields,
          outcome: 'error',
          ...(response.locals.observabilityError ? { error: serializeError(response.locals.observabilityError) } : {})
        });
      } else if (statusCode >= 400) {
        const level = [401, 403, 429].includes(statusCode) ? 'warn' : 'info';
        logger[level]('http.request.completed', { ...fields, outcome: 'client_error' });
      } else {
        logger.info('http.request.completed', { ...fields, outcome: 'success' });
      }
    });

    return runWithRequestContext(context, next);
  };
}

/**
 * Returns diagnostic context associated with the active inbound request.
 *
 * @returns {object|undefined} Active request context.
 */
function getHttpRequestContext() {
  return getRequestContext();
}

module.exports = { DEFAULT_SKIP_PATHS, createRequestContextMiddleware, getHttpRequestContext };
