const express = require('express');

/**
 * Creates the officer endpoint router (officer role only).
 *
 * @param {object} controller - Officer endpoint controllers.
 * @param {Function} requireOfficer - Auth middleware (account JWT + officer role).
 * @returns {import('express').Router} Express officer router.
 */
function createOfficerRouter(controller, requireOfficer) {
  const router = express.Router();
  router.get('/v1/officer/tickets/:ticketId', requireOfficer, controller.lookup);
  router.post('/v1/officer/tickets/:ticketId/scan', requireOfficer, controller.scan);
  router.get('/v1/officer/events/:eventId/attendees', requireOfficer, controller.listAttendees);
  return router;
}

module.exports = { createOfficerRouter };
