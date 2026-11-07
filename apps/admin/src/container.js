const { createHealthService } = require('@/modules/health/health.service');
const { createHealthController } = require('@/modules/health/health.controller');
const { createHealthRouter } = require('@/modules/health/health.route');
const { createStore } = require('@/infrastructure/store');
const { createVerifier } = require('@/infrastructure/auth');
const { createQueueClient } = require('@/infrastructure/queue-client');
const { createRequireAdmin } = require('@/middleware/require-admin');
const { createAuditService } = require('@/modules/audit/audit.service');
const { createEventService } = require('@/modules/events/event.service');
const { createEventController } = require('@/modules/events/event.controller');
const { createEventRouter } = require('@/modules/events/event.route');
const { createFeesService } = require('@/modules/fees/fees.service');
const { createFeesController } = require('@/modules/fees/fees.controller');
const { createFeesRouter } = require('@/modules/fees/fees.route');
const { createBookingsService } = require('@/modules/bookings/bookings.service');
const { createBookingsController } = require('@/modules/bookings/bookings.controller');
const { createBookingsRouter } = require('@/modules/bookings/bookings.route');
const { createUsersService } = require('@/modules/users/users.service');
const { createUsersController } = require('@/modules/users/users.controller');
const { createUsersRouter } = require('@/modules/users/users.route');
const { createQueueService } = require('@/modules/queue-admin/queue.service');
const { createQueueController } = require('@/modules/queue-admin/queue.controller');
const { createQueueRouter } = require('@/modules/queue-admin/queue.route');

/**
 * Mounts service routers and returns the reusable module dependencies.
 * Health endpoints are public; every /v1/admin/* route is behind the
 * admin guard (account JWT + role from the database, LLD-05 §2).
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.store] - Admin store (injected in tests).
 * @param {object} [options.auth] - Token verifier (injected in tests).
 * @param {object} [options.queueClient] - Queue admin API client (injected in tests).
 * @param {object} [options.config] - Runtime configuration (store/auth defaults).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady, store, auth, queueClient, config } = {}) {
  const healthService = createHealthService({ isReady });
  const healthController = createHealthController(healthService);
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
  const activeQueueClient =
    queueClient ||
    createQueueClient({
      baseUrl: config && config.queueAdminUrl,
      operatorToken: config && config.queueAdminToken
    });
  const requireAdmin = createRequireAdmin({ auth: activeAuth, store: activeStore });
  const audit = createAuditService(activeStore);

  const eventService = createEventService(activeStore, audit);
  const feesService = createFeesService(activeStore, audit);
  const bookingsService = createBookingsService(activeStore, audit);
  const usersService = createUsersService(activeStore);
  const queueService = createQueueService(activeStore, audit, activeQueueClient);

  app.use('/v1/admin', requireAdmin, createEventRouter(createEventController(eventService)));
  app.use('/v1/admin', requireAdmin, createFeesRouter(createFeesController(feesService)));
  app.use('/v1/admin', requireAdmin, createBookingsRouter(createBookingsController(bookingsService)));
  app.use('/v1/admin', requireAdmin, createUsersRouter(createUsersController(usersService)));
  app.use('/v1/admin', requireAdmin, createQueueRouter(createQueueController(queueService)));

  return { healthService, eventService, feesService, bookingsService, usersService, queueService };
}

module.exports = { mountRoutes };
