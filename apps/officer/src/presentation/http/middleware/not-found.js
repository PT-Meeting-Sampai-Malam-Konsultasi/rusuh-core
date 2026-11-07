const Boom = require('@hapi/boom');

/**
 * Passes an API not-found error to the final error handler.
 *
 * @param {import('express').Request} request - Incoming HTTP request.
 * @param {import('express').Response} _response - Express response object.
 * @param {Function} next - Express middleware continuation.
 * @returns {void}
 */
function notFound(request, _response, next) {
  next(Boom.notFound(`Route ${request.method} ${request.originalUrl} was not found`));
}

module.exports = { notFound };
