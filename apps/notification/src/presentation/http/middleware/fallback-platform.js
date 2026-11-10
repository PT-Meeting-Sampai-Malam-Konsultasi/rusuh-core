/**
 * Minimal platform fallback for the HTTP middleware (presentation layer).
 * The presentation layer may NOT import @/platform/common (the boundary
 * rule forbids presentation -> platform), so the middleware defaults to
 * this local shim when no platform is injected. In production app.js
 * (the composition root) always passes the real platform, so this is
 * only a safe default for direct use in tests.
 *
 * Only the surface the middleware actually uses is implemented:
 * - `LoggerBuilder` for chainable console logging.
 * - `logRequest`, which returns no extra metadata.
 * - `unifyResponse`, which returns undefined: the response middleware
 *   falls back to the raw payload then.
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

module.exports = { LoggerBuilder, logRequest, unifyResponse };
