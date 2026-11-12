require('./alias');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
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
 * @param {object} [options.accounts] - Auth account client for role lookup.
 * @param {object} [options.queueClient] - Queue admin API client.
 * @param {object} [options.stockSeeder] - Valkey stock seeder.
 * @param {object} [options.imageUploads] - Image upload presigner.
 * @returns {import('express').Express} Configured Express application.
 */
function createApp({
  config,
  platform = defaultPlatform,
  isReady,
  store,
  auth,
  accounts,
  queueClient,
  stockSeeder,
  imageUploads
} = {}) {
  if (!config) throw new Error('createApp requires validated configuration');

  const app = express();
  app.disable('x-powered-by');
  // Security headers (helmet defaults; this is a JSON API, no HTML is
  // rendered) and CORS (origins from config.corsOrigins, see
  // infrastructure/config/environment.js). Both run before the routes.
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

  mountRoutes(app, { platform, isReady, store, auth, accounts, queueClient, stockSeeder, imageUploads, config });
  app.use(notFound);
  app.use(createProblemHandler({ platform }));

  return app;
}

module.exports = { createApp };
