const Boom = require('@hapi/boom');
const { problemBody } = require('@/domain/problem');

/**
 * Terminal Express error handler. Renders RFC 9457 Problem JSON (repo
 * contract, api/openapi.yaml) with a stable machine `code` and a `traceId`
 * (the request correlation id when present).
 * The platform helper is INJECTED by the composition root (app.js); this file
 * never imports platform/ itself (Onion boundary: presentation/ may not
 * import platform/).
 *
 * @param {object} options - Error-handler dependencies.
 * @param {object} options.platform - Platform logging implementation (required).
 * @returns {Function} Express error middleware.
 */
function createErrorHandler({ platform } = {}) {
  if (!platform) throw new Error('createErrorHandler requires platform (injected by app.js)');
  // eslint-disable-next-line no-unused-vars -- Express requires the 4th error-middleware argument.
  return (error, request, response, _next) => {
    if (response.headersSent) return;

    const traceId = request.requestId;
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

    response.locals.observabilityError = error;
    response.locals.skipResponseEnvelope = true;
    response.status(statusCode).json(body);
  };
}

module.exports = { createErrorHandler };
