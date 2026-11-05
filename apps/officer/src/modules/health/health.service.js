/**
 * Creates health operations for liveness and readiness endpoints.
 *
 * @param {object} options - Health dependencies.
 * @param {Function} [options.isReady] - Optional asynchronous readiness predicate.
 * @returns {object} Health service.
 */
function createHealthService({ isReady = async () => true } = {}) {
  return {
    live: () => ({ status: 'ok' }),
    ready: async () => ({ status: (await isReady()) ? 'ready' : 'not_ready' })
  };
}

module.exports = { createHealthService };
