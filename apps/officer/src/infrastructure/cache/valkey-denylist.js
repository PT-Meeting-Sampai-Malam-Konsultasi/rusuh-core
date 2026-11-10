const Redis = require('ioredis');
const { VALKEY_NAMESPACES } = require('@rusuh/contracts').constants;

/**
 * Valkey jti denylist (Q42, read side). auth-module writes `denylist:{jti}`
 * on logout (TTL = remaining access-token life); officer-module reads it on
 * every token verification so a logged-out account cannot scan at the gate.
 * Fail-closed: a Valkey error throws DENYLIST_UNAVAILABLE so the caller can
 * reject with 503 instead of accepting a possibly-revoked token.
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

    async close() {
      redis.disconnect();
    }
  };
}

module.exports = { createValkeyDenylist };
