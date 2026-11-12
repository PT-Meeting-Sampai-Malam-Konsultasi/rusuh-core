require('./alias');

const express = require('express');
const helmet = require('helmet');
const { createCors } = require('@rusuh/http');
const defaultPlatform = require('@/platform/common');
const { createDuplicateKeyVerifier } = require('@/presentation/http/middleware/duplicate-json-keys');
const { createResponseMiddleware } = require('@/presentation/http/middleware/response');
const { createErrorHandler } = require('@/presentation/http/middleware/error-handler');
const { notFound } = require('@/presentation/http/middleware/not-found');
const { buildPaymentDeps } = require('@/container');
const { mountRoutes } = require('@/presentation/http/routes');

/**
 * Builds an Express application without binding a network port or starting jobs.
 *
 * @param {object} options - Application dependencies and runtime configuration.
 * @param {object} options.config - Validated service configuration.
 * @param {object} [options.platform] - Platform helper implementation.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.deps] - Injectable payment dependencies (tests).
 * @returns {import('express').Express} Configured Express application.
 */
function createApp({ config, platform = defaultPlatform, isReady, deps } = {}) {
  if (!config) throw new Error('createApp requires validated configuration');

  const app = express();
  app.disable('x-powered-by');
  // Security headers (helmet, defaults) + CORS, before any route is mounted.
  // The only public endpoint is the Midtrans webhook (server-to-server, so
  // CORS has no effect on it); helmet still protects the health endpoints
  // and any future browser-facing route.
  app.use(helmet());
  app.use(createCors(config.corsOrigins));
  app.use(createResponseMiddleware({ platform }));
  app.use(
    express.json({
      limit: config.bodyLimit,
      verify: createDuplicateKeyVerifier(config.enableDuplicateJsonKeyValidation)
    })
  );
  app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

  // The container builds the adapters + use cases (composition root);
  // the presentation layer only mounts the routes onto them.
  const paymentDeps = deps || buildPaymentDeps(config);
  mountRoutes(app, { platform, isReady, config, deps: paymentDeps });
  app.use(notFound);
  app.use(createErrorHandler({ platform }));

  return app;
}

module.exports = { createApp };
