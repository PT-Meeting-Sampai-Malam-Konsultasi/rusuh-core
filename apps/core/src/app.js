require('./alias');

const express = require('express');
const defaultPlatform = require('@/platform/common');
const { createDuplicateKeyVerifier } = require('@/presentation/http/middleware/duplicate-json-keys');
const { createResponseMiddleware } = require('@/presentation/http/middleware/response');
const { createErrorHandler } = require('@/presentation/http/middleware/error-handler');
const { notFound } = require('@/presentation/http/middleware/not-found');
const { mountRoutes } = require('@/presentation/http/routes');
const { createDefaultDeps } = require('@/container');

/**
 * Builds an Express application without binding a network port or starting jobs.
 *
 * @param {object} options - Application dependencies and runtime configuration.
 * @param {object} options.config - Validated service configuration.
 * @param {object} [options.platform] - Platform helper implementation.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.deps] - Pre-built dependency graph (createDeps).
 *   When omitted, the default (in-memory) graph is built from the config.
 * @returns {import('express').Express} Configured Express application.
 */
function createApp({ config, platform = defaultPlatform, isReady, deps } = {}) {
  if (!config) throw new Error('createApp requires validated configuration');

  const app = express();
  app.disable('x-powered-by');
  app.use(createResponseMiddleware({ platform }));
  app.use(
    express.json({
      limit: config.bodyLimit,
      verify: createDuplicateKeyVerifier(config.enableDuplicateJsonKeyValidation)
    })
  );
  app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

  const mounted = mountRoutes(app, { config, isReady, deps: deps || createDefaultDeps(config) });
  app.locals.deps = mounted.deps;
  app.use(notFound);
  app.use(createErrorHandler({ platform }));

  return app;
}

module.exports = { createApp };
