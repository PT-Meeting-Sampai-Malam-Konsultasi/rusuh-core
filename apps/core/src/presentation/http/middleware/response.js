/**
 * Creates middleware that applies the platform response envelope and logs completion.
 * The platform helper is INJECTED by the composition root (app.js); this file
 * never imports platform/ itself (Onion boundary: presentation/ may not
 * import platform/).
 *
 * @param {object} options - Response middleware dependencies.
 * @param {object} options.platform - Platform helper implementation (required).
 * @returns {Function} Express middleware.
 */
function createResponseMiddleware({ platform } = {}) {
  if (!platform) throw new Error('createResponseMiddleware requires platform (injected by app.js)');
  return (request, response, next) => {
    const originalSend = response.send.bind(response);

    response.send = function sendWithEnvelope(payload) {
      if (response.locals.skipResponseEnvelope || response.headersSent || Buffer.isBuffer(payload)) {
        return originalSend(payload);
      }

      response.send = originalSend;
      Promise.resolve(platform.unifyResponse?.(request, response, payload))
        .then((normalized) => {
          const statusCode = payload?.statusCode || normalized?.statusCode || response.statusCode;
          const body = payload?.message || normalized?.bodyResponse || payload;
          response.status(statusCode).send(body);
        })
        .catch(next);

      return response;
    };

    next();
  };
}

module.exports = { createResponseMiddleware };
