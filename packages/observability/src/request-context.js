const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');

const requestContextStorage = new AsyncLocalStorage();
const UUID_V4_OR_VARIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates the only accepted inbound request identifier format.
 *
 * @param {unknown} value - Header value supplied by an HTTP client.
 * @returns {string|null} Canonical UUID when valid, otherwise null.
 */
function validateRequestId(value) {
  if (typeof value !== 'string' || value.length !== 36 || value.trim() !== value) return null;
  return UUID_V4_OR_VARIANT.test(value) ? value.toLowerCase() : null;
}

/**
 * Chooses the immutable request ID from supported headers or a safe UUID.
 *
 * @param {object} headers - Lowercase HTTP request headers.
 * @param {() => string} [uuid] - UUID generator for deterministic tests.
 * @returns {string} Canonical request ID.
 */
function resolveRequestId(headers = {}, uuid = randomUUID) {
  return validateRequestId(headers['x-request-id']) || validateRequestId(headers['x-correlation-id']) || uuid();
}

/**
 * Reads the request-scoped observability context, when one is active.
 *
 * @returns {object|undefined} Current request context.
 */
function getRequestContext() {
  return requestContextStorage.getStore();
}

/**
 * Runs a callback with a request-scoped context without global mutable state.
 *
 * @param {object} context - Immutable request context.
 * @param {Function} callback - Work to execute within the request context.
 * @returns {*} Callback result.
 */
function runWithRequestContext(context, callback) {
  return requestContextStorage.run(Object.freeze({ ...context }), callback);
}

module.exports = { getRequestContext, resolveRequestId, runWithRequestContext, validateRequestId };
