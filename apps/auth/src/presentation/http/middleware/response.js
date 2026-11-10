/**
 * Creates middleware that applies the platform response envelope and logs completion.
 *
 * NOTE: presentation never imports platform/ (boundary rule) — the
 * platform shim is injected by the composition root via createApp.
 * When omitted, logging/envelope are skipped (all platform calls are optional).
 *
 * @param {object} options - Response middleware dependencies.
 * @param {object} [options.platform] - Platform helper implementation.
 * @returns {Function} Express middleware.
 */
function createResponseMiddleware({ platform = {} } = {}) {
  return (request, response, next) => {
    const originalSend = response.send.bind(response);
    let responseLogged = false;

    response.on('finish', () => {
      if (responseLogged) return;
      responseLogged = true;

      try {
        const logger = platform.LoggerBuilder?.getLogger?.();
        const metadata = platform.LoggerBuilder?.getMetadataFromRequest?.(request) || {};
        const logData = platform.logRequest?.(request, { statusCode: response.statusCode }) || {};
        logger
          ?.addTags?.(['response-middleware', 'finish'])
          ?.addData?.({ ...metadata, ...logData })
          ?.info?.('API request completed');
      } catch (_error) {
        // Logging must never interfere with the request lifecycle.
      }
    });

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
