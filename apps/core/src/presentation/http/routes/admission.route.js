const express = require('express');

/**
 * Creates the admission router.
 *
 * @param {object} controller - Admission controllers.
 * @param {object} auth - Auth middleware ({ requireServiceKey }).
 * @returns {import('express').Router} Express admission router.
 */
function createAdmissionRouter(controller, auth) {
  const router = express.Router();
  // Internal: queue -> core (registerAdmission, synchronous; ADR-0027
  // replaces the SQS admission event, ADR-0021/0023). NOT part of the
  // public API — only the queue calls it over the private network
  // (Service Connect) with a service key.
  router.post('/v1/core/admission', auth.requireServiceKey, controller.registerAdmission);
  return router;
}

module.exports = { createAdmissionRouter };
