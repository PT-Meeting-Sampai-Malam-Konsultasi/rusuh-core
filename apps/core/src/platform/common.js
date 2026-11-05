/**
 * Minimal local platform implementation replacing the private
 * `module-common-function` package from the boilerplate template.
 *
 * Only the surface this service actually uses is implemented:
 * - `LoggerBuilder` for chainable console logging. The template calls
 *   it through optional chaining, so logging never breaks requests.
 * - `logRequest`, which returns no extra metadata.
 * - `unifyResponse`, which returns undefined: the response middleware
 *   falls back to the raw payload then, which matches how this
 *   service's controllers respond (they set `skipResponseEnvelope`
 *   and return `{ data }`).
 * - `preHandler`, a pass-through: this mock serves unauthenticated
 *   verification endpoints, so platform authentication is never
 *   enabled (`usePlatformPreHandler` stays false).
 */
function createLogger() {
  const logger = {
    addTags: () => logger,
    addData: () => logger,
    info: (...args) => console.info(...args),
    error: (...args) => console.error(...args)
  };
  return logger;
}

const LoggerBuilder = {
  getLogger: () => createLogger(),
  getMetadataFromRequest: () => ({})
};

function logRequest() {
  return {};
}

function unifyResponse() {
  return undefined;
}

function preHandler(_request, _response, next) {
  next();
}

module.exports = { LoggerBuilder, logRequest, unifyResponse, preHandler };
