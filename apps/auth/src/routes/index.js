const { createHealthService } = require('@/modules/health/health.service');
const { createHealthController } = require('@/modules/health/health.controller');
const { createHealthRouter } = require('@/modules/health/health.route');
const { createOtpService } = require('@/modules/otp/otp.service');
const { createOtpController } = require('@/modules/otp/otp.controller');
const { createOtpRouter } = require('@/modules/otp/otp.route');
const { createSessionService } = require('@/modules/session/session.service');
const { createSessionController } = require('@/modules/session/session.controller');
const { createSessionRouter } = require('@/modules/session/session.route');
const { createProfileService } = require('@/modules/profile/profile.service');
const { createProfileController } = require('@/modules/profile/profile.controller');
const { createProfileRouter } = require('@/modules/profile/profile.route');
const { requireAccountToken } = require('@/middleware/auth');
const { createDependencies } = require('@/infrastructure/dependencies');

/**
 * Mounts service routers and returns the reusable module dependencies.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.dependencies] - Injected deps; built from config when omitted.
 * @param {object} [options.config] - Runtime configuration (for building deps).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady, dependencies, config } = {}) {
  const deps = dependencies || createDependencies(config || {});
  const { store, denylist, mailer, tokens, logger, otpSecret } = deps;

  const healthService = createHealthService({ isReady });
  const healthController = createHealthController(healthService);

  const otpService = createOtpService({ store, mailer, tokens, logger, otpSecret });
  const otpController = createOtpController(otpService);

  const sessionService = createSessionService({ store, denylist, tokens, logger });
  const sessionController = createSessionController(sessionService);

  const profileService = createProfileService({ store, logger });
  const profileController = createProfileController(profileService);

  const requireToken = requireAccountToken({ tokens, denylist });

  app.use(createHealthRouter(healthController));
  app.use('/v1/auth', createOtpRouter(otpController));
  app.use('/v1/auth', createSessionRouter(sessionController, requireToken));
  app.use('/v1', createProfileRouter(profileController, requireToken));

  return { healthService, otpService, sessionService, profileService, dependencies: deps };
}

module.exports = { mountRoutes };
