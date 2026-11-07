const express = require('express');
const { wrapController } = require('@/middleware/async-handler');

/**
 * Creates the admin event router (LLD-05 §5.1–§5.2). All routes are
 * admin-only (requireAdmin runs before the router is mounted).
 *
 * @param {object} controller - Event endpoint controllers.
 * @returns {import('express').Router} Express admin event router.
 */
function createEventRouter(controller) {
  const c = wrapController(controller);
  const router = express.Router();
  router.get('/events', c.listEvents);
  router.post('/events', c.createEvent);
  router.get('/events/:eventId', c.getEvent);
  router.put('/events/:eventId', c.updateEvent);
  router.get('/events/:eventId/cap', c.getCap);
  router.put('/events/:eventId/cap', c.updateCap);
  router.get('/events/:eventId/stats', c.getStats);
  return router;
}

module.exports = { createEventRouter };
