const express = require('express');

/**
 * Creates the internal router (service-key protected; NOT public API).
 * Consumed by core-module to resolve the buyer's e-mail + locale before
 * publishing an e-mail job (LLD-04 §3).
 *
 * @param {object} controller - Internal controllers.
 * @param {Function} requireServiceKeyMiddleware - Service-key middleware.
 * @returns {import('express').Router} Express router.
 */
function createInternalRouter(controller, requireServiceKeyMiddleware) {
  const router = express.Router();
  router.get('/internal/accounts/:accountId', requireServiceKeyMiddleware, controller.getAccount);
  return router;
}

module.exports = { createInternalRouter };
