const express = require('express');

/**
 * Creates the session router (refresh + logout).
 *
 * @param {object} controller - Session controllers.
 * @param {Function} requireAccountToken - Bearer JWT middleware (logout only).
 * @returns {import('express').Router} Express router.
 */
function createSessionRouter(controller, requireAccountToken) {
  const router = express.Router();
  router.post('/refresh', controller.refresh);
  router.post('/logout', requireAccountToken, controller.logout);
  return router;
}

module.exports = { createSessionRouter };
