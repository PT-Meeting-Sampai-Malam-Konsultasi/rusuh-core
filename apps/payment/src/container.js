const { createLogger } = require('@rusuh/observability');
const { createMetrics } = require('@/infrastructure/metrics');
const { createStore } = require('@/infrastructure/persistence/store');
const { createMidtransClient } = require('@/infrastructure/external/midtrans/midtrans-client');
const { createCoreClient } = require('@/infrastructure/external/core-client');
const { createSnapUseCase } = require('@/application/snap/snap.use-case');
const { createStatusUseCase } = require('@/application/status/status.use-case');
const { createWebhookUseCase } = require('@/application/webhook/webhook.use-case');

/**
 * COMPOSITION ROOT. This file lives at src/ root (not in infrastructure/)
 * because it imports from every layer to wire them together: it builds the
 * infrastructure adapters (store, Midtrans client, core client) and injects
 * them into the application use cases. No use case ever requires an adapter
 * directly — the wiring happens only here.
 */

/**
 * Builds the payment-module dependencies from the validated config.
 * The store is in-memory when no DATABASE_URL is set (dev/test) and Postgres
 * otherwise. The Midtrans client is only built when a Server Key is present;
 * without one the webhook still runs (every signature fails closed) and Snap
 * creation throws a clear error.
 *
 * @param {object} config - Validated service configuration.
 * @param {object} [overrides] - Injectable dependencies (tests).
 * @returns {object} Wired payment use cases and adapters.
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

  const snapUseCase =
    overrides.snapUseCase || (midtransClient ? createSnapUseCase({ store, midtransClient, metrics, logger }) : null);
  const statusUseCase =
    overrides.statusUseCase ||
    (midtransClient
      ? createStatusUseCase({
          midtransClient,
          metrics,
          logger,
          getStatusMaxRetries: config.getStatusMaxRetries,
          getStatusRetryBaseMs: config.getStatusRetryBaseMs
        })
      : null);
  const webhookUseCase =
    overrides.webhookUseCase ||
    (midtransClient && statusUseCase
      ? createWebhookUseCase({
          store,
          statusUseCase,
          coreClient,
          serverKey: config.midtrans.serverKey,
          metrics,
          logger,
          coreNotifyMaxRetries: config.core.notifyMaxRetries,
          coreNotifyRetryBaseMs: config.core.notifyRetryBaseMs
        })
      : null);

  return { logger, metrics, store, midtransClient, coreClient, snapUseCase, statusUseCase, webhookUseCase };
}

module.exports = { buildPaymentDeps };
