const { Pool } = require('pg');

/**
 * Creates a Postgres connection pool for the email_log dedup table.
 * Returns null when no connection string is configured — callers fall back
 * to the in-memory email_log store (degraded mode, loudly logged).
 *
 * @param {object} options - Pool options.
 * @param {string} [options.connectionString] - Postgres connection string.
 * @param {number} [options.max] - Max pool clients (default 5).
 * @param {Function} [options.PoolClass] - Pool constructor (tests).
 * @returns {object|null} Pool, or null when not configured.
 */
function createDbPool({ connectionString, max = 5, PoolClass = Pool } = {}) {
  if (!connectionString) return null;
  return new PoolClass({ connectionString, max });
}

module.exports = { createDbPool };
