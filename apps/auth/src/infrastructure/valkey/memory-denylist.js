/**
 * In-memory jti denylist (Q42) with TTL. Used for tests and for running
 * without Valkey (VALKEY_URL unset). Entries expire lazily on read.
 */
function createMemoryDenylist() {
  const entries = new Map(); // jti -> expiresAtMs

  return {
    async isDenied(jti) {
      const expiresAt = entries.get(jti);
      if (!expiresAt) return false;
      if (expiresAt <= Date.now()) {
        entries.delete(jti);
        return false;
      }
      return true;
    },

    async deny(jti, ttlSeconds) {
      entries.set(jti, Date.now() + ttlSeconds * 1000);
    },

    async close() {
      // nothing to close
    }
  };
}

module.exports = { createMemoryDenylist };
