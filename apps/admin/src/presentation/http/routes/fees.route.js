const express = require('express');
const { wrapController } = require('@/middleware/async-handler');

/**
 * Creates the admin fee-config router (LLD-05 §5.3). Admin-only.
 *
 * @param {object} controller - Fee endpoint controllers.
 * @returns {import('express').Router} Express admin fee router.
 */
function createFeesRouter(controller) {
  const c = wrapController(controller);
  const router = express.Router();
  router.get('/config/fees', c.getFees);
  router.put('/config/fees', c.updateFees);
  return router;
}

module.exports = { createFeesRouter };
