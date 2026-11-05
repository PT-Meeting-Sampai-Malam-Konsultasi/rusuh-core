const { createLogger } = require('@rusuh/observability');
const { createMetrics } = require('@/infrastructure/metrics');
const { createStore } = require('@/infrastructure/store');
const { createMidtransClient } = require('@/infrastructure/midtrans/midtrans-client');
const { createSnapService } = require('@/modules/snap/snap.service');
const { createHealthService } = require('@/modules/health/health.service');
const { createHealthController } = require('@/modules/health/health.controller');
const { createHealthRouter } = require('@/modules/health/health.route');

/**
 * Builds the payment-module dependencies from the validated config.
 * The store is in-memory when no DATABASE_URL is set (dev/test) and Postgres
 * otherwise. The Midtrans client is only built when a Server Key is present.
 *
 * @param {object} config - Validated service configuration.
 * @param {object} [overrides] - Injectable dependencies (tests).
 * @returns {object} Wired payment services.
 */
function buildPaymentDeps(config, overrides = {}) {
  const logger = overrides.logger || createLogger({ service: 'payment-service' });
  const metrics = overrides.metrics || createMetrics();
  const store =
    overrides.store || createStore({ kind: config.paymentStore, databaseUrl: config.databaseUrl || undefined });
  const midtransClient =
    overrides.midtransClient ||
    (config.midtrans.serverKey
      ? createMidtransClient({
          serverKey: config.midtrans.serverKey,
          snapBaseUrl: config.midtrans.snapBaseUrl,
          apiBaseUrl: config.midtrans.apiBaseUrl
        })
      : null);
  const snapService =
    overrides.snapService || (midtransClient ? createSnapService({ store, midtransClient, metrics, logger }) : null);

  return { logger, metrics, store, midtransClient, snapService };
}

/**
 * Mounts service routers and returns the reusable module dependencies.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {object} [options.config] - Validated service configuration.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.deps] - Injectable payment dependencies (tests).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { config, isReady, deps } = {}) {
  const healthService = createHealthService({ isReady });
  const healthController = createHealthController(healthService);
  app.use(createHealthRouter(healthController));

  // Internal operations (createSnapTransaction, confirmViaGetStatus,
  // expireOrder) are service functions used by core-module over the private
  // network — exposed through the returned deps, not as public routes.
  // The webhook (the ONLY public endpoint) is wired in the next commit.
  const paymentDeps = deps || (config ? buildPaymentDeps(config) : null);

  return { healthService, ...paymentDeps };
}

module.exports = { mountRoutes, buildPaymentDeps };
