const express = require('express');

/**
 * Creates the OTP router (openapi.yaml paths are canonical; the LLD-01
 * /otp/request path is mounted as an alias, same handler).
 *
 * @param {object} controller - OTP controllers.
 * @returns {import('express').Router} Express router.
 */
function createOtpRouter(controller) {
  const router = express.Router();
  router.post('/otp', controller.request);
  router.post('/otp/request', controller.request);
  router.post('/otp/verify', controller.verify);
  return router;
}

module.exports = { createOtpRouter };
