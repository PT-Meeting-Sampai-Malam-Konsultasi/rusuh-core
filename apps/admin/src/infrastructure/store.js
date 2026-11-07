const { createMemoryStore } = require('./memory-store');
const { createPostgresStore } = require('./postgres-store');

/**
 * Store factory. Postgres when DATABASE_URL is set, otherwise the
 * in-memory store (tests + local development without a database).
 * The interface is identical either way (see memory-store.js).
 *
 * @param {object} config - Runtime configuration.
 * @param {string} [config.databaseUrl] - Postgres connection string.
 * @returns {object} Store.
 */
function createStore(config = {}) {
  if (config.databaseUrl) return createPostgresStore({ connectionString: config.databaseUrl });
  return createMemoryStore();
}

module.exports = { createStore };
