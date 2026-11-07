const Boom = require('@hapi/boom');
const defaultPlatform = require('@/platform/common');

/**
 * Creates the terminal Express error handler with safe client responses.
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
    let boomError = null;
    if (Boom.isBoom(error)) {
      boomError = error;
    } else if (isMalformedJson) {
      boomError = Boom.badRequest('Malformed JSON request body');
    }
    const statusCode = boomError?.output?.statusCode || 500;
    const body = boomError?.output?.payload || {
      statusCode,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred'
    };

    try {
      const logger = platform.LoggerBuilder?.getLogger?.();
      const metadata = platform.LoggerBuilder?.getMetadataFromRequest?.(request) || {};
      logger
        ?.addTags?.(['error-handler'])
        ?.addData?.({ ...metadata, statusCode, error: error.message })
        ?.error?.('API request failed');
    } catch (_loggingError) {
      // Logging failures must not prevent a safe error response.
    }

    response.locals.skipResponseEnvelope = true;
    response.status(statusCode).json(body);
  };
}

module.exports = { createErrorHandler };
