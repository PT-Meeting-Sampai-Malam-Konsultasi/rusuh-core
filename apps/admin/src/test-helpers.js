const { loadEnvironment } = require('@/infrastructure/config/environment');
const { createApp } = require('@/app');
const { createMemoryStore } = require('@/infrastructure/persistence/memory-store');

/**
 * Test app factory: memory store + a mock token verifier.
 * Tokens: 'admin-token' -> acc_admin_01 (admin), 'officer-token' ->
 * acc_officer_01 (officer), 'customer-token' -> acc_customer_01 (customer).
 * Anything else is rejected (401).
 *
 * @param {object} [options] - Overrides.
 * @param {object} [options.store] - Store to use.
 * @param {object} [options.queueClient] - Queue client to use.
 * @param {object} [options.stockSeeder] - Stock seeder double.
 * @param {object} [options.imageUploads] - Image upload double.
 * @param {object} [options.config] - Config override.
 * @returns {object} { app, store }.
 */
function createTestApp({ store, queueClient, stockSeeder, imageUploads, config } = {}) {
  const activeStore = store || createMemoryStore();
  const auth = {
    verify: async (token) => {
      const accounts = {
        'admin-token': { sub: 'acc_admin_01' },
        'officer-token': { sub: 'acc_officer_01' },
        'customer-token': { sub: 'acc_customer_01' }
      };
      if (!accounts[token]) {
        const error = new Error('Invalid account token');
        error.code = 'UNAUTHORIZED';
        throw error;
      }
      return accounts[token];
    }
  };
  const accounts = {
    async getAccount(accountId) {
      return activeStore.getUserById(accountId);
    }
  };
  const app = createApp({
    config: config || loadEnvironment({}),
    store: activeStore,
    auth,
    accounts,
    queueClient,
    stockSeeder,
    imageUploads
  });
  return { app, store: activeStore };
}

module.exports = { createTestApp };
