require('./alias');

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const defaultPlatform = require('@/platform/common');
const { createDuplicateKeyVerifier } = require('@/presentation/http/middleware/duplicate-json-keys');
const { createResponseMiddleware } = require('@/presentation/http/middleware/response');
const { createErrorHandler } = require('@/presentation/http/middleware/error-handler');
const { notFound } = require('@/presentation/http/middleware/not-found');
const { mountRoutes } = require('@/presentation/http/routes');
const { createDependencies } = require('@/container');

/**
 * Builds an Express application without binding a network port or starting jobs.
 *
 * @param {object} options - Application dependencies and runtime configuration.
 * @param {object} options.config - Validated service configuration.
 * @param {object} [options.platform] - Platform helper implementation.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.dependencies] - Injected deps ({ store, denylist,
 *   mailer, tokens, logger }); built from config when omitted.
 * @returns {import('express').Express} Configured Express application.
 */
function createApp({ config, platform = defaultPlatform, isReady, dependencies } = {}) {
  if (!config) throw new Error('createApp requires validated configuration');
  const deps = dependencies || createDependencies(config);

  const app = express();
  app.disable('x-powered-by');
  // Security headers (helmet, defaults) + CORS, before any route is mounted.
  // CORS origins come from config (CORS_ORIGINS env, comma-separated).
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(cookieParser());
  app.use(createResponseMiddleware({ platform }));
  app.use(
    express.json({
      limit: config.bodyLimit,
      verify: createDuplicateKeyVerifier(config.enableDuplicateJsonKeyValidation)
    })
  );
  app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

  mountRoutes(app, { platform, isReady, dependencies: deps });
  app.use(notFound);
  app.use(createErrorHandler({ platform }));

  return app;
}

module.exports = { createApp };
