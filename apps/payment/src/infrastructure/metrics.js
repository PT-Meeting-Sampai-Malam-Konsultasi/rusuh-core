/**
 * In-memory metrics counters (LLD-03 §8). Production ships them to CloudWatch;
 * this registry is the in-process source of truth for tests and local runs.
 *
 * Counters: webhook_received, webhook_valid, webhook_invalid,
 * webhook_unconfirmed, snap_created, get_status_calls, expire_calls,
 * amount_mismatch_count, core_callback_failures, midtrans_5xx_count.
 */
function createMetrics() {
  const counts = new Map();

  return {
    increment(name, by = 1) {
      counts.set(name, (counts.get(name) || 0) + by);
    },
    get(name) {
      return counts.get(name) || 0;
    },
    snapshot() {
      return Object.fromEntries(counts);
    }
  };
}

module.exports = { createMetrics };
