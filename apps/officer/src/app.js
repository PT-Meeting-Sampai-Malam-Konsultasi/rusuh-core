// See server.js: register `@` explicitly (monorepo hoisting; the hoisted
// module-alias would read the ROOT package.json, which has no _moduleAliases).
require('module-alias').addAlias('@', __dirname);

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const defaultPlatform = require('@/platform/common');
const { createDuplicateKeyVerifier } = require('@/presentation/http/middleware/duplicate-json-keys');
const { createResponseMiddleware } = require('@/presentation/http/middleware/response');
const { createErrorHandler } = require('@/presentation/http/middleware/error-handler');
const { notFound } = require('@/presentation/http/middleware/not-found');
const { mountRoutes } = require('@/container');

/**
 * Builds an Express application without binding a network port or starting jobs.
 *
 * @param {object} options - Application dependencies and runtime configuration.
 * @param {object} options.config - Validated service configuration.
 * @param {object} [options.platform] - Platform helper implementation.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.officerDeps] - Injected officer dependencies (tests).
 * @returns {import('express').Express} Configured Express application.
 */
function createApp({ config, platform = defaultPlatform, isReady, officerDeps } = {}) {
  if (!config) throw new Error('createApp requires validated configuration');

  const app = express();
  app.disable('x-powered-by');
  // Security headers (helmet, defaults) + CORS, before any route is mounted.
  // This is a JSON API (no HTML is rendered), so helmet's defaults are fine.
  // CORS origins come from config (CORS_ORIGINS, comma-separated).
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(createResponseMiddleware({ platform }));
  app.use(
    express.json({
      limit: config.bodyLimit,
      verify: createDuplicateKeyVerifier(config.enableDuplicateJsonKeyValidation)
    })
  );
  app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

  mountRoutes(app, { isReady, config, officerDeps });
  app.use(notFound);
  app.use(createErrorHandler({ platform }));

  return app;
}

module.exports = { createApp };
