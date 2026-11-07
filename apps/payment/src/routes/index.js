const { createLogger } = require('@rusuh/observability');
const { createMetrics } = require('@/infrastructure/metrics');
const { createStore } = require('@/infrastructure/store');
const { createMidtransClient } = require('@/infrastructure/midtrans/midtrans-client');
const { createCoreClient } = require('@/infrastructure/core/core-client');
const { createSnapService } = require('@/modules/snap/snap.service');
const { createStatusService } = require('@/modules/status/status.service');
const { createWebhookService } = require('@/modules/webhook/webhook.service');
const { createWebhookController } = require('@/modules/webhook/webhook.controller');
const { createWebhookRouter, webhookErrorHandler } = require('@/modules/webhook/webhook.route');
const { createHealthService } = require('@/modules/health/health.service');
const { createHealthController } = require('@/modules/health/health.controller');
const { createHealthRouter } = require('@/modules/health/health.route');

/**
 * Builds the payment-module dependencies from the validated config.
 * The store is in-memory when no DATABASE_URL is set (dev/test) and Postgres
 * otherwise. The Midtrans client is only built when a Server Key is present;
 * without one the webhook still runs (every signature fails closed) and Snap
 * creation throws a clear error.
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
  const coreClient =
    overrides.coreClient ||
    createCoreClient({
      baseUrl: config.core.internalUrl,
      credential: config.core.serviceCredential || undefined,
      timeoutMs: config.core.notifyTimeoutMs
    });

  const snapService =
    overrides.snapService || (midtransClient ? createSnapService({ store, midtransClient, metrics, logger }) : null);
  const statusService =
    overrides.statusService ||
    (midtransClient
      ? createStatusService({
          midtransClient,
          metrics,
          logger,
          getStatusMaxRetries: config.getStatusMaxRetries,
          getStatusRetryBaseMs: config.getStatusRetryBaseMs
        })
      : null);
  const webhookService =
    overrides.webhookService ||
    (midtransClient && statusService
      ? createWebhookService({
          store,
          statusService,
          coreClient,
          serverKey: config.midtrans.serverKey,
          metrics,
          logger,
          coreNotifyMaxRetries: config.core.notifyMaxRetries,
          coreNotifyRetryBaseMs: config.core.notifyRetryBaseMs
        })
      : null);

  return { logger, metrics, store, midtransClient, coreClient, snapService, statusService, webhookService };
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

  // The webhook is the ONLY public endpoint of this module. Internal
  // operations (createSnapTransaction, confirmViaGetStatus, expireOrder) are
  // service functions used by core-module over the private network — they are
  // exposed through the returned deps, not as public routes.
  const paymentDeps = deps || (config ? buildPaymentDeps(config) : null);
  if (paymentDeps?.webhookService) {
    const webhookController = createWebhookController(paymentDeps.webhookService, {
      bodyLimitBytes: config?.webhookBodyLimitBytes,
      logger: paymentDeps.logger
    });
    app.use(createWebhookRouter(webhookController));
    app.use(webhookErrorHandler);
  }

  return { healthService, ...paymentDeps };
}

module.exports = { mountRoutes, buildPaymentDeps };
