const express = require('express');

/**
 * Creates the attendees router.
 *
 * @param {object} controller - Attendees controllers.
 * @param {object} auth - Auth middleware ({ requireAccount, requireAdmission }).
 * @returns {import('express').Router} Express attendees router.
 */
function createAttendeesRouter(controller, auth) {
  const router = express.Router();
  router.post(
    '/v1/core/events/:eventId/attendees/validate',
    auth.requireAccount,
    auth.requireAdmission,
    controller.validateAttendee
  );
  return router;
}

module.exports = { createAttendeesRouter };
