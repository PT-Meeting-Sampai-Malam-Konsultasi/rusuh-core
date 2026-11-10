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
const { requireServiceKey } = require('@/presentation/http/middleware/service-key');
const { createInternalUseCase } = require('@/application/internal/internal.use-case');
const { createInternalController } = require('@/presentation/http/controllers/internal.controller');
const { createInternalRouter } = require('@/presentation/http/routes/internal.route');

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
function mountRoutes(app, { isReady, dependencies, config } = {}) {
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

  const internalUseCase = createInternalUseCase({ store });
  const internalController = createInternalController(internalUseCase);
  const requireSvcKey = requireServiceKey({ serviceKey: config && config.serviceKey });

  app.use(createHealthRouter(healthController));
  app.use('/v1/auth', createOtpRouter(otpController));
  app.use('/v1/auth', createSessionRouter(sessionController, requireToken));
  app.use('/v1', createProfileRouter(profileController, requireToken));
  app.use('/v1', createInternalRouter(internalController, requireSvcKey));

  return {
    healthUseCase,
    otpUseCase,
    sessionUseCase,
    profileUseCase,
    internalUseCase,
    dependencies: deps
  };
}

module.exports = { mountRoutes };
