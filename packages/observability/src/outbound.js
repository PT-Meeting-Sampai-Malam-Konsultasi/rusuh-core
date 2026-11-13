const { getRequestContext } = require('./request-context');

/**
 * Adds correlation metadata to an explicit outbound header set.
 * Trace context is intentionally left to OpenTelemetry instrumentation.
 *
 * @param {object} [headers] - Explicit adapter-owned headers.
 * @param {object} [context] - Request context override for tests or jobs.
 * @returns {object} Headers with the canonical request ID when available.
 */
function createOutboundHeaders(headers = {}, context = getRequestContext()) {
  return {
    ...headers,
    ...(context?.requestId ? { 'X-Request-ID': context.requestId } : {})
  };
}

module.exports = { createOutboundHeaders };
