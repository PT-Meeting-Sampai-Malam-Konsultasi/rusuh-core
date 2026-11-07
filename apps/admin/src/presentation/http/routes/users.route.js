const express = require('express');
const { wrapController } = require('@/middleware/async-handler');

/**
 * Creates the admin user router (LLD-05 §6.3, read side). Admin-only.
 *
 * @param {object} controller - User endpoint controllers.
 * @returns {import('express').Router} Express admin user router.
 */
function createUsersRouter(controller) {
  const c = wrapController(controller);
  const router = express.Router();
  router.get('/users', c.listUsers);
  return router;
}

module.exports = { createUsersRouter };
