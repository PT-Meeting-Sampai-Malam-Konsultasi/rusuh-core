const { createHealthUseCase } = require('@/application/health/health.use-case');
const { createHealthController } = require('@/presentation/http/controllers/health.controller');
const { createHealthRouter } = require('@/presentation/http/routes/health.route');
const { createStore } = require('@/infrastructure/persistence/store');
const { createVerifier } = require('@/infrastructure/auth');
const { createAuthAccountsClient } = require('@/infrastructure/external/auth-accounts');
const { createImageUploads } = require('@/infrastructure/storage/image-uploads');
const { createStockSeeder } = require('@/infrastructure/stock/valkey-stock');
const { createQueueClient } = require('@/infrastructure/external/queue-admin');
const { createRequireAdmin } = require('@/presentation/http/middleware/require-admin');
const { createAuditUseCase } = require('@/application/audit/audit.use-case');
const { createEventUseCase } = require('@/application/events/event.use-case');
const { createEventController } = require('@/presentation/http/controllers/event.controller');
const { createEventRouter } = require('@/presentation/http/routes/event.route');
const { createFeesUseCase } = require('@/application/fees/fees.use-case');
const { createFeesController } = require('@/presentation/http/controllers/fees.controller');
const { createFeesRouter } = require('@/presentation/http/routes/fees.route');
const { createBookingsUseCase } = require('@/application/bookings/bookings.use-case');
const { createBookingsController } = require('@/presentation/http/controllers/bookings.controller');
const { createBookingsRouter } = require('@/presentation/http/routes/bookings.route');
const { createUsersUseCase } = require('@/application/users/users.use-case');
const { createUsersController } = require('@/presentation/http/controllers/users.controller');
const { createUsersRouter } = require('@/presentation/http/routes/users.route');
const { createQueueUseCase } = require('@/application/queue-admin/queue.use-case');
const { createQueueController } = require('@/presentation/http/controllers/queue.controller');
const { createQueueRouter } = require('@/presentation/http/routes/queue.route');

/**
 * Composition root. Wires the layers together: infrastructure adapters
 * (store, token verifier, queue-admin client) are built here (or taken
 * from the injected options in tests) and handed to the application use
 * cases, which are handed to the presentation controllers and routers.
 * This file lives at src/ root precisely because it imports from every
 * layer — it is exempt from the boundary check (see scripts/check-boundaries.js).
 * Mounts service routers and returns the reusable module dependencies.
 * Health endpoints are public; every /v1/admin/* route is behind the
 * admin guard (account JWT + role from the database, LLD-05 §2).
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.store] - Admin store (injected in tests).
 * @param {object} [options.auth] - Token verifier (injected in tests).
 * @param {object} [options.accounts] - Auth account client (injected in tests).
 * @param {object} [options.stockSeeder] - Valkey stock seeder (injected in tests).
 * @param {object} [options.imageUploads] - Image upload presigner (injected in tests).
 * @param {object} [options.queueClient] - Queue admin API client (injected in tests).
 * @param {object} [options.config] - Runtime configuration (store/auth defaults).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady, store, auth, accounts, queueClient, stockSeeder, imageUploads, config } = {}) {
  const healthUseCase = createHealthUseCase({ isReady });
  const healthController = createHealthController(healthUseCase);
  app.use(createHealthRouter(healthController));

  const activeStore = store || createStore(config || {});
  const activeAuth =
    auth ||
    createVerifier({
      jwksJson: config && config.authPublicKeyJwk,
      jwksUrl: config && config.authJwksUrl,
      expectedAud: config && config.authAudience,
      expectedIss: config && config.authIssuer
    });
  const activeAccounts =
    accounts ||
    createAuthAccountsClient({ baseUrl: config && config.authUrl, serviceKey: config && config.serviceKey });
  const activeQueueClient =
    queueClient ||
    createQueueClient({
      baseUrl: config && config.queueAdminUrl,
      operatorToken: config && config.queueAdminToken
    });
  const requireAdmin = createRequireAdmin({ auth: activeAuth, accounts: activeAccounts });
  const audit = createAuditUseCase(activeStore);

  const activeStockSeeder = stockSeeder || createStockSeeder({ url: config && config.valkeyUrl });
  const activeImageUploads =
    imageUploads ||
    createImageUploads({
      bucket: config && config.assetsBucket,
      assetBaseUrl: config && config.assetBaseUrl,
      region: config && config.awsRegion
    });
  const eventUseCase = createEventUseCase(activeStore, audit, {
    stockSeeder: activeStockSeeder,
    imageUploads: activeImageUploads,
    assetBaseUrl: config && config.assetBaseUrl
  });
  const feesUseCase = createFeesUseCase(activeStore, audit);
  const bookingsUseCase = createBookingsUseCase(activeStore, audit);
  const usersUseCase = createUsersUseCase(activeStore);
  const queueUseCase = createQueueUseCase(activeStore, audit, activeQueueClient);

  app.use('/v1/admin', requireAdmin, createEventRouter(createEventController(eventUseCase)));
  app.use('/v1/admin', requireAdmin, createFeesRouter(createFeesController(feesUseCase)));
  app.use('/v1/admin', requireAdmin, createBookingsRouter(createBookingsController(bookingsUseCase)));
  app.use('/v1/admin', requireAdmin, createUsersRouter(createUsersController(usersUseCase)));
  app.use('/v1/admin', requireAdmin, createQueueRouter(createQueueController(queueUseCase)));

  return { healthUseCase, eventUseCase, feesUseCase, bookingsUseCase, usersUseCase, queueUseCase };
}

module.exports = { mountRoutes };
