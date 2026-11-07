require('./alias');

const express = require('express');
const defaultPlatform = require('@/platform/common');
const { createDuplicateKeyVerifier } = require('@/presentation/http/middleware/duplicate-json-keys');
const { createResponseMiddleware } = require('@/presentation/http/middleware/response');
const { createProblemHandler } = require('@/presentation/http/middleware/problem-handler');
const { notFound } = require('@/presentation/http/middleware/not-found');
const { mountRoutes } = require('@/container');

/**
 * Builds an Express application without binding a network port or starting jobs.
 *
 * @param {object} options - Application dependencies and runtime configuration.
 * @param {object} options.config - Validated service configuration.
 * @param {object} [options.platform] - Platform helper implementation.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.store] - Admin store (defaults to the configured store).
 * @param {object} [options.auth] - Token verifier { verify(token) }.
 * @param {object} [options.queueClient] - Queue admin API client.
 * @returns {import('express').Express} Configured Express application.
 */
function createApp({ config, platform = defaultPlatform, isReady, store, auth, queueClient } = {}) {
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

  mountRoutes(app, { platform, isReady, store, auth, queueClient, config });
  app.use(notFound);
  app.use(createProblemHandler({ platform }));

  return app;
}

module.exports = { createApp };
