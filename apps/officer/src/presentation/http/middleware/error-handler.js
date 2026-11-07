const Boom = require('@hapi/boom');
const { officerProblem, isKnownCode } = require('@/domain/errors');

/**
 * Creates the terminal Express error handler with safe client responses.
 * Errors carrying a machine code in `data.code` (repo/officer codes) are
 * rendered as Problem JSON (RFC 9457); everything else keeps the Boom
 * payload / generic 500 shape. The platform is injected by the composition
 * root (app.js) — presentation must not import platform/ directly
 * (boundary rule).
 *
 * @param {object} options - Error-handler dependencies.
 * @param {object} options.platform - Platform logging implementation.
 * @returns {Function} Express error middleware.
 */
function createErrorHandler({ platform } = {}) {
  if (!platform) throw new Error('createErrorHandler requires platform');
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

    const code = boomError?.data?.code || (error && typeof error.code === 'string' ? error.code : null);
    const knownCode = code && isKnownCode(code) ? code : null;
    const statusCode = knownCode
      ? officerProblem(knownCode, boomError?.message || error.message).status
      : boomError?.output?.statusCode || 500;
    const body = knownCode
      ? officerProblem(knownCode, boomError?.message || error.message, boomError?.data?.extra || {})
      : boomError?.output?.payload || {
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
