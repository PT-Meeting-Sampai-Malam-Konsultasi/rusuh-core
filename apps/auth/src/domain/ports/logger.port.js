/**
 * Logger port — the structured-logging contract the use cases depend on.
 * Implemented by @rusuh/observability (createLogger) in the composition
 * root; use cases only ever call info/error.
 *
 * @typedef {object} Logger
 * @property {function(...*): void} info - Informational log line.
 * @property {function(...*): void} error - Error log line.
 */

module.exports = {};
