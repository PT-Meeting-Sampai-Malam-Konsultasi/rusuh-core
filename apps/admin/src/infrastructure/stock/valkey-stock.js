const Redis = require('ioredis');

/**
 * Seeds live stock in Valkey for newly created categories. Keys and invariant
 * (available + held + sold = total) mirror core's stockKey layout. SET NX makes
 * it idempotent and never overwrites counters that already moved.
 *
 * @param {object} options - Stock options.
 * @param {string} [options.url] - Valkey URL. Unset = stock seeding is skipped (local dev).
 * @param {object} [options.client] - ioredis client (tests).
 * @returns {object} { seedCategories(eventId, categories), close() }.
 */
function createStockSeeder({ url, client } = {}) {
  const redis = client || (url ? new Redis(url, { maxRetriesPerRequest: 2 }) : null);

  return {
    isEnabled: Boolean(redis),

    async seedCategories(eventId, categories) {
      if (!redis) return;
      const pipeline = redis.multi();
      categories.forEach((category) => {
        const prefix = `stock:${eventId}:${category.category_id}`;
        pipeline.set(`${prefix}:available`, category.total, 'NX');
        pipeline.set(`${prefix}:held`, 0, 'NX');
        pipeline.set(`${prefix}:sold`, 0, 'NX');
      });
      await pipeline.exec();
    },

    async close() {
      if (redis) await redis.quit();
    }
  };
}

module.exports = { createStockSeeder };
