const Boom = require('@hapi/boom');
const { ApiError, problemBody, statusFor } = require('@/domain/errors');

/**
 * Maps an HTTP status to the repo Problem code (for Boom errors raised
 * by the skeleton middleware, e.g. notFound).
 *
 * @param {number} status - HTTP status.
 * @returns {string} Problem code.
 */
function codeForStatus(status) {
  if (status === 400) return 'VALIDATION_FAILED';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  return 'INTERNAL_ERROR';
}

/**
 * Terminal Express error handler rendering RFC 9457 Problem JSON
 * (repo contract, api/openapi.yaml). ApiError carries the repo code;
 * Joi validation errors become VALIDATION_FAILED (400); anything else
 * becomes INTERNAL_ERROR (500) without leaking internals.
 *
 * @param {object} options - Error-handler dependencies.
 * @param {object} options.platform - Platform logging implementation (injected by the
 *   composition root; the presentation layer must not require() platform/).
 * @returns {Function} Express error middleware.
 */
function createProblemHandler({ platform } = {}) {
  if (!platform) throw new Error('createProblemHandler requires platform');
  // eslint-disable-next-line no-unused-vars -- Express requires the 4th error-middleware argument.
  return (error, request, response, _next) => {
    if (response.headersSent) return;

    let code = 'INTERNAL_ERROR';
    let detail;
    let extra = {};
    if (error instanceof ApiError) {
      code = error.code;
      detail = error.detail;
      extra = error.extra || {};
    } else if (Boom.isBoom(error)) {
      code = codeForStatus(error.output.statusCode);
      detail = error.message;
    } else if (error && error.isJoi) {
      code = 'VALIDATION_FAILED';
      detail = error.details.map((item) => item.message).join(', ');
    } else if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) {
      code = 'VALIDATION_FAILED';
      detail = 'Malformed JSON request body';
    }

    const status = statusFor(code);
    const body = problemBody(code, detail, {
      ...(request.correlationId ? { traceId: request.correlationId } : {}),
      ...extra
    });

    try {
      const logger = platform.LoggerBuilder?.getLogger?.();
      const metadata = platform.LoggerBuilder?.getMetadataFromRequest?.(request) || {};
      logger
        ?.addTags?.(['problem-handler'])
        ?.addData?.({ ...metadata, statusCode: status, error: error.message, code })
        ?.error?.('API request failed');
    } catch (_loggingError) {
      // Logging failures must not prevent a safe error response.
    }

    response.locals.skipResponseEnvelope = true;
    response.status(status).json(body);
  };
}

module.exports = { createProblemHandler };
