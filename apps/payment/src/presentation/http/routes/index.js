const { createHealthUseCase } = require('@/application/health/health.use-case');
const { createHealthController } = require('@/presentation/http/controllers/health.controller');
const { createHealthRouter } = require('@/presentation/http/routes/health.route');
const { createWebhookController } = require('@/presentation/http/controllers/webhook.controller');
const { createWebhookRouter, webhookErrorHandler } = require('@/presentation/http/routes/webhook.route');

/**
 * Mounts service routers and returns the reusable module dependencies.
 * The dependencies themselves are built by the container (src/container.js)
 * and passed in as `deps` — this module only mounts routes, it never builds
 * adapters or use cases.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {object} [options.config] - Validated service configuration.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.deps] - Payment dependencies from the container (tests may inject).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { config, isReady, deps } = {}) {
  const healthUseCase = createHealthUseCase({ isReady });
  const healthController = createHealthController(healthUseCase);
  app.use(createHealthRouter(healthController));

  // The webhook is the ONLY public endpoint of this module. Internal
  // operations (createSnapTransaction, confirmViaGetStatus, expireOrder) are
  // use-case functions used by core-module over the private network — they are
  // exposed through the returned deps, not as public routes.
  const paymentDeps = deps;
  if (paymentDeps?.webhookUseCase) {
    const webhookController = createWebhookController(paymentDeps.webhookUseCase, {
      bodyLimitBytes: config?.webhookBodyLimitBytes,
      logger: paymentDeps.logger
    });
    app.use(createWebhookRouter(webhookController));
    app.use(webhookErrorHandler);
  }

  return { healthUseCase, ...paymentDeps };
}

module.exports = { mountRoutes };
