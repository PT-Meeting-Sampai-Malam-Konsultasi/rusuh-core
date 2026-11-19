const express = require('express');

/**
 * Creates browser-facing payment facade routes. Booking state remains owned by
 * core; this prefix preserves the public payment-domain API contract.
 *
 * @param {object} controller - Payment facade controllers.
 * @param {object} auth - Authentication middleware.
 * @returns {import('express').Router} Payment facade router.
 */
function createPaymentRouter(controller, auth) {
  const router = express.Router();
  router.get('/v1/payment/payments/:bookingId', auth.requireAccount, controller.getPaymentPage);
  router.post('/v1/payment/payments/:bookingId/snap', auth.requireAccount, controller.startSnap);
  router.get('/v1/payment/payments/:bookingId/status', auth.requireAccount, controller.getPaymentStatus);
  return router;
}

module.exports = { createPaymentRouter };
