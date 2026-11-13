const SENSITIVE_KEY =
  /(password|secret|token|authorization|cookie|nik|database.?url|connection.?string|qr.?payload|payment|admission|turnstile|device)/i;
const REDACTED = '[REDACTED]';

/**
 * Removes credentials and query strings from URL-shaped text.
 *
 * @param {string} value - Potentially sensitive string.
 * @returns {string} Sanitized string.
 */
function sanitizeString(value) {
  return String(value)
    .replace(/(bearer|basic)\s+[a-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/\b((?:token|secret|password|passwd|nik|authorization|api[_-]?key)\s*[=:]\s*)[^\s&#,;]+/gi, '$1[REDACTED]')
    .replace(/\b\d{16}\b/g, '[REDACTED]')
    .replace(/:\/\/[^\s/@:]+:[^\s/@]+@/g, '://[REDACTED]@');
}

/**
 * Removes sensitive values from logging data without mutating its source.
 *
 * @param {unknown} value - Value to sanitize for structured logging.
 * @param {WeakSet<object>} [seen] - Objects already visited during recursion.
 * @returns {unknown} Sanitized value safe for JSON serialization.
 */
function sanitizeForLog(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (value instanceof Error) {
    if (seen.has(value)) return { type: value.name || 'Error', message: '[Circular]' };
    seen.add(value);
    return {
      type: value.name || 'Error',
      message: sanitizeString(value.message || ''),
      ...(value.code ? { code: sanitizeString(String(value.code)) } : {}),
      ...(value.stack ? { stack: sanitizeString(value.stack) } : {}),
      ...(value.cause ? { cause: sanitizeForLog(value.cause, seen) } : {})
    };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : sanitizeForLog(nested, seen)
    ])
  );
}

module.exports = { REDACTED, sanitizeForLog, serializeError: sanitizeForLog };
