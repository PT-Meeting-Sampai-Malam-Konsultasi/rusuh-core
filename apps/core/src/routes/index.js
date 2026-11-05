const { createHealthService } = require('@/modules/health/health.service');
const { createHealthController } = require('@/modules/health/health.controller');
const { createHealthRouter } = require('@/modules/health/health.route');

/**
 * Mounts service routers and returns the reusable module dependencies.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady } = {}) {
  const healthService = createHealthService({ isReady });
  const healthController = createHealthController(healthService);

  app.use(createHealthRouter(healthController));

  return { healthService };
}

module.exports = { mountRoutes };
