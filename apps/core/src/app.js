require('./alias');

const express = require('express');
const helmet = require('helmet');
const { createCors } = require('@rusuh/http');
const { createLogger, createRequestContextMiddleware } = require('@rusuh/observability');
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
 * @param {Function} [options.isShuttingDown] - Optional shutdown predicate (for /readyz).
 * @param {object} [options.deps] - Pre-built dependency graph (createDeps).
 *   When omitted, the default (in-memory) graph is built from the config.
 * @returns {import('express').Express} Configured Express application.
 */
function createApp({ config, platform = defaultPlatform, logger, isReady, isShuttingDown, deps } = {}) {
  if (!config) throw new Error('createApp requires validated configuration');
  const requestLogger =
    logger ||
    createLogger({
      service: 'core',
      environment: config.nodeEnv,
      instanceId: config.observability.serviceInstanceId,
      format: config.observability.logFormat
    });

  const app = express();
  app.disable('x-powered-by');
  // Security headers (helmet, defaults) + CORS. Both run before the routes
  // are mounted. The CORS allowlist is config.corsOrigins (CORS_ORIGINS env,
  // comma-separated; defaults to the production web + local dev origins).
  // This is a JSON-only API (no HTML is rendered), so helmet's defaults fit.
  app.use(helmet());
  app.use(createCors(config.corsOrigins));
  app.use(createRequestContextMiddleware({ logger: requestLogger }));
  app.use(createResponseMiddleware({ platform }));
  app.use(
    express.json({
      limit: config.bodyLimit,
      verify: createDuplicateKeyVerifier(config.enableDuplicateJsonKeyValidation)
    })
  );
  app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

  const mounted = mountRoutes(app, {
    config,
    isReady,
    isShuttingDown,
    deps: deps || createDefaultDeps(config)
  });
  app.locals.deps = mounted.deps;
  app.use(notFound);
  app.use(createErrorHandler({ platform }));
  app.locals.observabilityLogger = requestLogger;

  return app;
}

module.exports = { createApp };
