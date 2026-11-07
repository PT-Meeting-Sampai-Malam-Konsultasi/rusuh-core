const Boom = require('@hapi/boom');
const defaultPlatform = require('@/platform/common');
const { problemBody } = require('@/lib/problem');

/**
 * Terminal Express error handler. Renders RFC 9457 Problem JSON (repo
 * contract, api/openapi.yaml) with a stable machine `code` and a `traceId`
 * (the request correlation id when present).
 *
 * @param {object} options - Error-handler dependencies.
 * @param {object} [options.platform] - Platform logging implementation.
 * @returns {Function} Express error middleware.
 */
function createErrorHandler({ platform = defaultPlatform } = {}) {
  // eslint-disable-next-line no-unused-vars -- Express requires the 4th error-middleware argument.
  return (error, request, response, _next) => {
    if (response.headersSent) return;

    const { correlationId } = request;
    const traceId = correlationId || request.headers['x-correlation-id'] || undefined;
    let body;
    if (error && error.problem) {
      body = { ...error.problem, ...(traceId ? { traceId } : {}) };
    } else if (Boom.isBoom(error)) {
      const { statusCode } = error.output;
      let code = 'INTERNAL_ERROR';
      if (statusCode === 400) code = 'VALIDATION_FAILED';
      else if (statusCode === 404) code = 'NOT_FOUND';
      body = problemBody(code, error.message, traceId ? { traceId } : {});
      body.status = statusCode;
    } else if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) {
      body = problemBody('VALIDATION_FAILED', 'Malformed JSON request body', traceId ? { traceId } : {});
    } else {
      body = problemBody('INTERNAL_ERROR', 'An unexpected error occurred', traceId ? { traceId } : {});
    }
    const statusCode = body.status || 500;

    try {
      const logger = platform.LoggerBuilder?.getLogger?.();
      const metadata = platform.LoggerBuilder?.getMetadataFromRequest?.(request) || {};
      logger
        ?.addTags?.(['error-handler'])
        ?.addData?.({ ...metadata, statusCode, error: error.message, code: body.code })
        ?.error?.('API request failed');
    } catch (_loggingError) {
      // Logging failures must not prevent a safe error response.
    }

    response.locals.skipResponseEnvelope = true;
    response.status(statusCode).json(body);
  };
}

module.exports = { createErrorHandler };
