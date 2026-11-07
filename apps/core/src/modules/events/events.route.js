const express = require('express');

/**
 * Creates the events router.
 *
 * @param {object} controller - Events controllers.
 * @param {object} auth - Auth middleware ({ requireAccount, requireAdmission }).
 * @returns {import('express').Router} Express events router.
 */
function createEventsRouter(controller, auth) {
  const router = express.Router();
  router.get('/v1/events', controller.listEvents);
  router.get('/v1/events/:eventId', controller.getEvent);
  router.get('/v1/events/:eventId/categories', auth.requireAccount, auth.requireAdmission, controller.getCategories);
  return router;
}

module.exports = { createEventsRouter };
