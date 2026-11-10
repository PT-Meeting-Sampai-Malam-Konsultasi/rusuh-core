const { createHealthUseCase } = require('@/application/health/health.use-case');
const { createHealthController } = require('@/presentation/http/controllers/health.controller');
const { createHealthRouter } = require('@/presentation/http/routes/health.route');
const { createOtpUseCase } = require('@/application/otp/otp.use-case');
const { createOtpController } = require('@/presentation/http/controllers/otp.controller');
const { createOtpRouter } = require('@/presentation/http/routes/otp.route');
const { createSessionUseCase } = require('@/application/session/session.use-case');
const { createSessionController } = require('@/presentation/http/controllers/session.controller');
const { createSessionRouter } = require('@/presentation/http/routes/session.route');
const { createProfileUseCase } = require('@/application/profile/profile.use-case');
const { createProfileController } = require('@/presentation/http/controllers/profile.controller');
const { createProfileRouter } = require('@/presentation/http/routes/profile.route');
const { requireAccountToken } = require('@/presentation/http/middleware/auth');

/**
 * Mounts service routers and returns the reusable module dependencies.
 * The dependencies are built by the composition root (src/container.js,
 * via createApp) and injected here — presentation never builds or
 * imports infrastructure adapters itself.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} options.dependencies - Injected deps (required).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady, dependencies } = {}) {
  if (!dependencies) throw new Error('mountRoutes requires dependencies (built by the composition root)');
  const deps = dependencies;
  const { store, denylist, mailer, tokens, logger, otpSecret } = deps;

  const healthUseCase = createHealthUseCase({ isReady });
  const healthController = createHealthController(healthUseCase);

  const otpUseCase = createOtpUseCase({ store, mailer, tokens, logger, otpSecret });
  const otpController = createOtpController(otpUseCase);

  const sessionUseCase = createSessionUseCase({ store, denylist, tokens, logger });
  const sessionController = createSessionController(sessionUseCase);

  const profileUseCase = createProfileUseCase({ store, logger });
  const profileController = createProfileController(profileUseCase);

  const requireToken = requireAccountToken({ tokens, denylist });

  app.use(createHealthRouter(healthController));
  app.use('/v1/auth', createOtpRouter(otpController));
  app.use('/v1/auth', createSessionRouter(sessionController, requireToken));
  app.use('/v1', createProfileRouter(profileController, requireToken));

  return { healthUseCase, otpUseCase, sessionUseCase, profileUseCase, dependencies: deps };
}

module.exports = { mountRoutes };
