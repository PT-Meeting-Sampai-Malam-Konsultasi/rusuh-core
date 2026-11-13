const { createRequestContextMiddleware, DEFAULT_SKIP_PATHS, getHttpRequestContext } = require('./http-middleware');
const { classifyHttpFailure, instrumentAdapter, reportHttpFailure } = require('./dependency');
const { createLogger } = require('./logger');
const { createOutboundHeaders } = require('./outbound');
const { getRequestContext, resolveRequestId, runWithRequestContext, validateRequestId } = require('./request-context');
const { REDACTED, sanitizeForLog, serializeError } = require('./redaction');
const { createTelemetry, validateTelemetryConfig } = require('./telemetry');

module.exports = {
  classifyHttpFailure,
  instrumentAdapter,
  reportHttpFailure,
  createLogger,
  createOutboundHeaders,
  createRequestContextMiddleware,
  createTelemetry,
  DEFAULT_SKIP_PATHS,
  getHttpRequestContext,
  getRequestContext,
  REDACTED,
  resolveRequestId,
  runWithRequestContext,
  sanitizeForLog,
  serializeError,
  validateRequestId,
  validateTelemetryConfig
};
