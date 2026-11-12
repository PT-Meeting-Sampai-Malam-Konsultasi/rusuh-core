const cors = require('cors');

/** Allowlist used when CORS_ORIGINS is unset or yields no usable entry. */
const DEFAULT_CORS_ORIGINS = Object.freeze([
  'https://rusuh-tiket.web.id',
  'https://www.rusuh-tiket.web.id',
  'http://localhost:3000',
  'http://localhost:5173'
]);

/**
 * Parses a comma-separated CORS_ORIGINS value into an origin list.
 *
 * @param {string|null} [value] - Raw comma-separated origins.
 * @returns {string[]} Trimmed, non-empty origins; a fresh copy of
 * DEFAULT_CORS_ORIGINS when nothing usable remains.
 */
function parseCorsOrigins(value) {
  const parsed = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_CORS_ORIGINS];
}

/**
 * Builds the CORS middleware shared by every service. Same behaviour as the
 * previous per-service setup: origin allowlist, no credentials.
 *
 * @param {string[]} origins - Allowed origins (config.corsOrigins).
 * @returns {import('express').RequestHandler} CORS middleware.
 */
function createCors(origins) {
  return cors({ origin: origins });
}

module.exports = { DEFAULT_CORS_ORIGINS, parseCorsOrigins, createCors };
