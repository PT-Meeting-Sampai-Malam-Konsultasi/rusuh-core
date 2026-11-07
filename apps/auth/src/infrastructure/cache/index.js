const { createMemoryDenylist } = require('./memory-denylist');
const { createValkeyDenylist } = require('./valkey-denylist');

/**
 * Picks the denylist implementation from config: Valkey when VALKEY_URL is
 * set, otherwise the in-memory denylist (tests / local dev without Valkey).
 *
 * @param {object} config - Runtime configuration.
 * @returns {object} Denylist.
 */
function createDenylist(config = {}) {
  if (config.valkeyUrl) return createValkeyDenylist({ valkeyUrl: config.valkeyUrl });
  return createMemoryDenylist();
}

module.exports = { createDenylist, createMemoryDenylist, createValkeyDenylist };
