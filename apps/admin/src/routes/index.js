const { createHealthService } = require('@/modules/health/health.service');
const { createHealthController } = require('@/modules/health/health.controller');
const { createHealthRouter } = require('@/modules/health/health.route');
const { createStore } = require('@/infrastructure/store');
const { createVerifier } = require('@/infrastructure/auth');
const { createRequireAdmin } = require('@/middleware/require-admin');
const { createAuditService } = require('@/modules/audit/audit.service');
const { createEventService } = require('@/modules/events/event.service');
const { createEventController } = require('@/modules/events/event.controller');
const { createEventRouter } = require('@/modules/events/event.route');

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
 * @param {object} [options.config] - Runtime configuration (store/auth defaults).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady, store, auth, config } = {}) {
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
  const requireAdmin = createRequireAdmin({ auth: activeAuth, store: activeStore });
  const audit = createAuditService(activeStore);

  const eventService = createEventService(activeStore, audit);

  app.use('/v1/admin', requireAdmin, createEventRouter(createEventController(eventService)));

  return { healthService, eventService };
}

module.exports = { mountRoutes };
