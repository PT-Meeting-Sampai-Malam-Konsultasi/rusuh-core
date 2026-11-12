const express = require('express');

/**
 * Creates the profile router. openapi.yaml canonical path is /v1/me;
 * /v1/auth/profile (GET + PUT) is the LLD-01 path, mounted as an alias.
 *
 * @param {object} controller - Profile controllers.
 * @param {Function} requireAccountToken - Bearer JWT middleware.
 * @param {object} [emailChangeController] - Email-change controllers (/v1/auth/email-change*).
 * @returns {import('express').Router} Express router.
 */
function createProfileRouter(controller, requireAccountToken, emailChangeController) {
  const router = express.Router();
  if (emailChangeController) {
    router.post('/auth/email-change', requireAccountToken, emailChangeController.start);
    router.post('/auth/email-change/verify', requireAccountToken, emailChangeController.verify);
  }
  router.get('/me', requireAccountToken, controller.getMe);
  router.get('/auth/profile', requireAccountToken, controller.getMe);
  router.put('/auth/profile', requireAccountToken, controller.update);
  return router;
}

module.exports = { createProfileRouter };
