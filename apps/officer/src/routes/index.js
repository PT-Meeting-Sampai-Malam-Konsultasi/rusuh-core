const { createHealthService } = require('@/modules/health/health.service');
const { createHealthController } = require('@/modules/health/health.controller');
const { createHealthRouter } = require('@/modules/health/health.route');
const { createOfficerService } = require('@/modules/officer/officer.service');
const { createOfficerController } = require('@/modules/officer/officer.controller');
const { createOfficerRouter } = require('@/modules/officer/officer.route');
const { createRequireRole } = require('@/middleware/auth');
const { createDefaultVerifyToken, createPostgresRoleResolver } = require('@/infrastructure/auth-provider');
const { createPostgresTicketStore, createPool } = require('@/infrastructure/ticket-store');
const { createPostgresAuditStore } = require('@/infrastructure/audit-store');
const { createNikCrypto } = require('@/infrastructure/nik-crypto');
const { apiError } = require('@/errors');

/**
 * Builds officer dependencies from config when they are not injected.
 * Fail-closed: without a database the stores throw 503 SERVICE_UNAVAILABLE
 * per request (the app still loads and the health endpoints still work);
 * without NIK/auth config the matching step fails closed (401/503).
 *
 * @param {object} config - Validated service configuration.
 * @returns {object} Officer dependencies.
 */
function buildOfficerDeps(config) {
  const pool = config.databaseUrl ? createPool(config.databaseUrl) : null;
  const unavailable = async () => {
    throw apiError('SERVICE_UNAVAILABLE', 'Database is not configured');
  };
  const ticketStore = pool
    ? createPostgresTicketStore(pool)
    : { findByCodeOrId: unavailable, findEvent: unavailable, markUsed: unavailable, listByEvent: unavailable };
  const auditStore = pool ? createPostgresAuditStore(pool) : { insert: unavailable, list: unavailable };
  const nikCrypto = config.nikEncryptionKey
    ? createNikCrypto({ key: config.nikEncryptionKey })
    : {
        decrypt: async () => {
          throw new Error('NIK_ENCRYPTION_KEY is not configured');
        },
        encrypt: () => {
          throw new Error('NIK_ENCRYPTION_KEY is not configured');
        }
      };
  const verifyToken = createDefaultVerifyToken(config);
  const roleResolver = pool ? createPostgresRoleResolver(pool) : async () => null;

  return { ticketStore, auditStore, nikCrypto, verifyToken, roleResolver };
}

/**
 * Mounts service routers and returns the reusable module dependencies.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {object} [options.platform] - Platform helper implementation.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.config] - Validated service configuration (for default officer deps).
 * @param {object} [options.officerDeps] - Injected officer dependencies (tests).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady, config, officerDeps } = {}) {
  const healthService = createHealthService({ isReady });
  const healthController = createHealthController(healthService);

  const deps = officerDeps || (config ? buildOfficerDeps(config) : null);
  let officerService = null;
  if (deps) {
    officerService = createOfficerService(deps);
    const officerController = createOfficerController(officerService);
    const requireOfficer = createRequireRole({
      verifyToken: deps.verifyToken,
      roleResolver: deps.roleResolver,
      requiredRole: 'officer'
    });
    app.use(createOfficerRouter(officerController, requireOfficer));
  }

  app.use(createHealthRouter(healthController));

  return { healthService, officerService };
}

module.exports = { mountRoutes, buildOfficerDeps };
