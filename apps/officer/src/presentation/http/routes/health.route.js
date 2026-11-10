const express = require('express');

/**
 * Creates the health endpoint router.
 *
 * @param {object} controller - Health endpoint controllers.
 * @returns {import('express').Router} Express health router.
 */
function createHealthRouter(controller) {
  const router = express.Router();
  router.get('/sys/ping', controller.ping);
  router.get('/health/live', controller.live);
  router.get('/health/ready', controller.ready);
  return router;
}

module.exports = { createHealthRouter };
