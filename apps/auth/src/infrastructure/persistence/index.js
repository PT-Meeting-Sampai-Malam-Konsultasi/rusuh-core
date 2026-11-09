const { createMemoryStore } = require('./memory-store');
const { createPostgresStore } = require('./postgres-store');

/**
 * Picks the store implementation from config: Postgres when DATABASE_URL is
 * set, otherwise the in-memory store (tests / local dev without a DB).
 *
 * @param {object} config - Runtime configuration.
 * @returns {object} Store.
 */
function createStore(config = {}) {
  if (config.databaseUrl) {
    return createPostgresStore({ databaseUrl: config.databaseUrl, logger: config.logger });
  }
  return createMemoryStore();
}

module.exports = { createStore };
