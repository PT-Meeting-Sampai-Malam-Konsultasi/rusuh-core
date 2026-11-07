const defaultPlatform = require('@/platform/common');
const { toProblem } = require('@/lib/api-error');

/**
 * Creates the terminal Express error handler. All errors are rendered as
 * RFC 9457 Problem JSON (repo contract), with the request correlation id
 * as traceId when available.
 *
 * @param {object} options - Error-handler dependencies.
 * @param {object} [options.platform] - Platform logging implementation.
 * @returns {Function} Express error middleware.
 */
function createErrorHandler({ platform = defaultPlatform } = {}) {
  // eslint-disable-next-line no-unused-vars -- Express requires the 4th error-middleware argument.
  return (error, request, response, _next) => {
    if (response.headersSent) return;

    const isMalformedJson = error instanceof SyntaxError && Object.hasOwn(error, 'body');
    const effective = isMalformedJson
      ? Object.assign(new Error('Malformed JSON request body'), { data: { code: 'BAD_REQUEST' } })
      : error;
    const traceId = request.correlationId || request.headers['x-correlation-id'];
    const { status, body } = toProblem(effective, traceId);

    try {
      const logger = platform.LoggerBuilder?.getLogger?.();
      const metadata = platform.LoggerBuilder?.getMetadataFromRequest?.(request) || {};
      logger
        ?.addTags?.(['error-handler'])
        ?.addData?.({ ...metadata, statusCode: status, error: error.message })
        ?.error?.('API request failed');
    } catch (_loggingError) {
      // Logging failures must not prevent a safe error response.
    }

    response.locals.skipResponseEnvelope = true;
    response.status(status).json(body);
  };
}

module.exports = { createErrorHandler };
