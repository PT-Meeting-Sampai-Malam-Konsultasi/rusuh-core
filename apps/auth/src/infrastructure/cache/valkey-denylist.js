const Redis = require('ioredis');
const { VALKEY_NAMESPACES } = require('@rusuh/contracts').constants;

/**
 * Valkey jti denylist (Q42): `denylist:{jti}` = marker, TTL = remaining
 * access-token life (self-cleaning). Fail-closed: a Valkey error throws
 * DENYLIST_UNAVAILABLE so the caller can reject with 503 (LLD-01 §6.3).
 *
 * @param {object} config - { valkeyUrl }.
 * @returns {object} Denylist.
 */
function createValkeyDenylist({ valkeyUrl }) {
  const redis = new Redis(valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true
  });

  const unavailable = (error) => {
    const wrapped = new Error(`Denylist unavailable: ${error.message}`);
    wrapped.code = 'DENYLIST_UNAVAILABLE';
    wrapped.cause = error;
    return wrapped;
  };

  return {
    async isDenied(jti) {
      try {
        const value = await redis.get(`${VALKEY_NAMESPACES.denylist}${jti}`);
        return value !== null;
      } catch (error) {
        throw unavailable(error);
      }
    },

    async deny(jti, ttlSeconds) {
      try {
        await redis.set(`${VALKEY_NAMESPACES.denylist}${jti}`, '1', 'EX', Math.max(1, Math.floor(ttlSeconds)));
      } catch (error) {
        throw unavailable(error);
      }
    },

    async close() {
      redis.disconnect();
    }
  };
}

module.exports = { createValkeyDenylist };
