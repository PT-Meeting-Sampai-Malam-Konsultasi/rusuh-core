/**
 * COMPOSITION ROOT. Wires the layers together: builds the infrastructure
 * adapters from config, injects them into the application use cases, and
 * mounts the presentation routers. This file lives at src/ root (not in
 * infrastructure/) because it imports from every layer — src/*.js files
 * are exempt from the boundary check for exactly this reason.
 */
const { createHealthUseCase } = require('@/application/health/health.use-case');
const { createHealthController } = require('@/presentation/http/controllers/health.controller');
const { createHealthRouter } = require('@/presentation/http/routes/health.route');
const { createOfficerUseCase } = require('@/application/officer/officer.use-case');
const { createOfficerController } = require('@/presentation/http/controllers/officer.controller');
const { createOfficerRouter } = require('@/presentation/http/routes/officer.route');
const { createRequireRole } = require('@/presentation/http/middleware/auth');
const { createDefaultVerifyToken, createPostgresRoleResolver } = require('@/infrastructure/auth-provider');
const { createPostgresTicketStore, createPool } = require('@/infrastructure/persistence/ticket-store');
const { createPostgresAuditStore } = require('@/infrastructure/persistence/audit-store');
const { createValkeyDenylist } = require('@/infrastructure/cache/valkey-denylist');
const { createNikCrypto } = require('@/domain/nik');
const { apiError } = require('@/domain/errors');

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
  const denylist = config.valkeyUrl ? createValkeyDenylist({ valkeyUrl: config.valkeyUrl }) : null;
  if (!denylist && config.nodeEnv !== 'test') {
    console.warn('[officer] VALKEY_URL not set: jti denylist is off (logout does not revoke gate tokens).');
  }
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
  const verifyToken = createDefaultVerifyToken(config, denylist);
  const roleResolver = pool ? createPostgresRoleResolver(pool) : async () => null;

  return { ticketStore, auditStore, nikCrypto, verifyToken, roleResolver, denylist };
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
  const healthUseCase = createHealthUseCase({ isReady });
  const healthController = createHealthController(healthUseCase);

  const deps = officerDeps || (config ? buildOfficerDeps(config) : null);
  let officerUseCase = null;
  if (deps) {
    officerUseCase = createOfficerUseCase(deps);
    const officerController = createOfficerController(officerUseCase);
    const requireOfficer = createRequireRole({
      verifyToken: deps.verifyToken,
      roleResolver: deps.roleResolver,
      requiredRole: 'officer'
    });
    app.use(createOfficerRouter(officerController, requireOfficer));
  }

  app.use(createHealthRouter(healthController));

  return { healthUseCase, officerUseCase };
}

module.exports = { mountRoutes, buildOfficerDeps };
