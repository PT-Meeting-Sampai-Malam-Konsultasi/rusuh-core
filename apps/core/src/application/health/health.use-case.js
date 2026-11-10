/**
 * Creates health operations for liveness and readiness endpoints.
 *
 * @param {object} options - Health dependencies.
 * @param {Function} [options.isReady] - Optional asynchronous readiness predicate.
 * @param {Function} [options.isShuttingDown] - Optional shutdown predicate
 *   (true once SIGTERM shutdown has started; /readyz then answers 503).
 * @returns {object} Health use case.
 */
function createHealthUseCase({ isReady = async () => true, isShuttingDown = () => false } = {}) {
  return {
    live: () => ({ status: 'ok' }),
    ready: async () => ({ status: (await isReady()) ? 'ready' : 'not_ready' }),
    // /readyz: 200 while the app serves traffic, 503 once shutdown starts
    // (mirrors the queue's /readyz: the ALB stops sending new requests
    // as soon as the task starts draining).
    readyz: () => ({ status: isShuttingDown() ? 'not_ready' : 'ok' })
  };
}

module.exports = { createHealthUseCase };
