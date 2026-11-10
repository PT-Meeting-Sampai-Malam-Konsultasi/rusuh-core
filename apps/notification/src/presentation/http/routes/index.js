const { createHealthUseCase } = require('@/application/health/health.use-case');
const { createHealthController } = require('../controllers/health.controller');
const { createHealthRouter } = require('./health.route');

/**
 * Mounts service routers and returns the reusable module dependencies.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady } = {}) {
  const healthService = createHealthUseCase({ isReady });
  const healthController = createHealthController(healthService);

  app.use(createHealthRouter(healthController));

  return { healthService };
}

module.exports = { mountRoutes };
