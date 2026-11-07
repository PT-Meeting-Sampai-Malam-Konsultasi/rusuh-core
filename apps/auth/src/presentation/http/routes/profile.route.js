const express = require('express');

/**
 * Creates the profile router. openapi.yaml canonical path is /v1/me;
 * /v1/auth/profile (GET + PUT) is the LLD-01 path, mounted as an alias.
 *
 * @param {object} controller - Profile controllers.
 * @param {Function} requireAccountToken - Bearer JWT middleware.
 * @returns {import('express').Router} Express router.
 */
function createProfileRouter(controller, requireAccountToken) {
  const router = express.Router();
  router.get('/me', requireAccountToken, controller.getMe);
  router.get('/auth/profile', requireAccountToken, controller.getMe);
  router.put('/auth/profile', requireAccountToken, controller.update);
  return router;
}

module.exports = { createProfileRouter };
