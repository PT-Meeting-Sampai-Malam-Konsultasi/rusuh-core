/**
 * Creates health operations for liveness and readiness endpoints.
 *
 * @param {object} options - Health dependencies.
 * @param {Function} [options.isReady] - Optional asynchronous readiness predicate.
 * @returns {object} Health use case.
 */
function createHealthUseCase({ isReady = async () => true } = {}) {
  return {
    live: () => ({ status: 'ok' }),
    ready: async () => ({ status: (await isReady()) ? 'ready' : 'not_ready' })
  };
}

module.exports = { createHealthUseCase };
