const { getRequestContext } = require('./request-context');

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
]);
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Classifies an outbound HTTP failure into a stable, low-cardinality category.
 *
 * @param {Error} error - Error thrown by the HTTP call.
 * @param {object} [options] - Classification hints.
 * @param {boolean} [options.timedOut] - True when the adapter's own deadline fired.
 * @returns {'timeout'|'canceled'|'dns'|'connection'|'unexpected_response'|'unknown'} Failure category.
 */
function classifyHttpFailure(error, { timedOut = false } = {}) {
  const code = error?.cause?.code || error?.code;
  if (timedOut || error?.name === 'TimeoutError') return 'timeout';
  if (error?.name === 'AbortError') return 'canceled';
  if (DNS_CODES.has(code)) return 'dns';
  if (CONNECTION_CODES.has(code)) return 'connection';
  if (Number.isInteger(error?.status)) return 'unexpected_response';
  return 'unknown';
}

/**
 * Logs one outbound HTTP dependency failure with allowlisted metadata only.
 * Never throws and never logs URLs, headers, or bodies.
 *
 * @param {object} options - Failure details.
 * @param {object} [options.logger] - Structured logger; no-op when absent.
 * @param {string} options.service - Allowlisted upstream name (e.g. "dukcapil").
 * @param {string} options.operation - Safe operation name (e.g. "verify").
 * @param {Error} options.error - Underlying error.
 * @param {boolean} [options.timedOut] - True when the adapter deadline fired.
 * @param {number} [options.startedAt] - Start time from performance.now().
 * @returns {void}
 */
function reportHttpFailure({ logger, service, operation, error, timedOut, startedAt }) {
  try {
    logger?.warn('dependency.http.failed', {
      requestId: getRequestContext()?.requestId,
      'upstream.service': service,
      'upstream.operation': operation,
      'upstream.failure_category': classifyHttpFailure(error, { timedOut }),
      ...(Number.isInteger(error?.status) ? { 'upstream.status_code': error.status } : {}),
      ...(startedAt === undefined ? {} : { durationMs: Math.round(performance.now() - startedAt) }),
      error: { type: error?.constructor?.name || 'Error', message: error?.message }
    });
  } catch (_error) {
    // Diagnostics must never alter the caller's error path.
  }
}

/**
 * Wraps an adapter so rejected async methods are logged, then rethrown unchanged.
 * Only the adapter name, method name, and SQLSTATE (when present) are logged.
 *
 * @param {object} target - Adapter instance (e.g. PgStore, RedisStock).
 * @param {object} options - Wrapper options.
 * @param {object} options.logger - Structured logger.
 * @param {'postgres'|'valkey'} options.kind - Dependency kind.
 * @returns {object} Proxy that behaves exactly like the target.
 */
function instrumentAdapter(target, { logger, kind }) {
  const event = `dependency.${kind}.failed`;
  const operationField = kind === 'postgres' ? 'db.operation' : 'cache.operation';
  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string' || property.startsWith('_')) return value;
      return (...args) => {
        const reportFailure = (error) => {
          try {
            logger.error(event, {
              requestId: getRequestContext()?.requestId,
              [operationField]: property,
              ...(kind === 'postgres' && SQLSTATE.test(error?.code || '') ? { 'db.sqlstate': error.code } : {}),
              // pg sets error.name to the lowercase string "error"; the class name is the useful value.
              error: { type: error?.constructor?.name || 'Error' }
            });
          } catch (_error) {
            // Diagnostics must never alter the caller's error path.
          }
        };
        let result;
        try {
          result = value.apply(object, args);
        } catch (error) {
          reportFailure(error);
          throw error;
        }
        if (typeof result?.then !== 'function') return result;
        return result.catch((error) => {
          reportFailure(error);
          throw error;
        });
      };
    }
  });
}

module.exports = { classifyHttpFailure, instrumentAdapter, reportHttpFailure };
