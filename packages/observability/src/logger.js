const { trace } = require('@opentelemetry/api');
const { sanitizeForLog } = require('./redaction');

/**
 * Reads the active OTel span identifiers, kept under `otel.*` so they never
 * collide with the problem-body `traceId`, which is the request ID.
 *
 * @returns {object} Trace fields, or an empty object without a valid active span.
 */
function activeTraceFields() {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return {};
  return { 'otel.trace_id': spanContext.traceId, 'otel.span_id': spanContext.spanId };
}

/**
 * Builds an immutable structured logger that safely writes one event per line.
 *
 * @param {object} options - Logger configuration.
 * @param {string} options.service - Stable logical service name.
 * @param {string} [options.environment] - Deployment environment name.
 * @param {string} [options.instanceId] - Safe service instance identifier.
 * @param {'json'|'text'} [options.format] - Output format; production uses JSON.
 * @param {(line: string) => void} [options.write] - Output writer for tests or stdout.
 * @param {object} [options.bindings] - Stable metadata inherited by child loggers.
 * @returns {object} Immutable logger.
 */
function createLogger({
  service = 'rusuh-core',
  environment = process.env.NODE_ENV || 'development',
  instanceId,
  format = process.env.LOG_FORMAT || 'json',
  write = (line) => process.stdout.write(`${line}\n`),
  bindings = {}
} = {}) {
  const base = {
    service,
    'deployment.environment.name': environment,
    ...(instanceId ? { 'service.instance.id': instanceId } : {}),
    ...sanitizeForLog(bindings)
  };

  /**
   * Emits one sanitized event without allowing output failure to affect callers.
   *
   * @param {'debug'|'info'|'warn'|'error'} level - Event severity.
   * @param {string} event - Stable event name.
   * @param {object} [fields] - Explicit safe metadata.
   * @returns {void}
   */
  function emit(level, event, fields = {}) {
    try {
      const record = {
        timestamp: new Date().toISOString(),
        level,
        ...base,
        event,
        ...activeTraceFields(),
        ...sanitizeForLog(fields)
      };
      write(format === 'text' ? `${record.level} ${record.event} ${JSON.stringify(record)}` : JSON.stringify(record));
    } catch (_error) {
      // Logging is strictly best effort.
    }
  }

  const logger = {
    child: (fields = {}) =>
      createLogger({ service, environment, instanceId, format, write, bindings: { ...base, ...fields } }),
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    addTags: (tags) => logger.child({ tags }),
    addData: (data) => logger.child(data)
  };
  return Object.freeze(logger);
}

module.exports = { createLogger };
