const express = require('express');

/**
 * Creates the bookings router.
 *
 * @param {object} controller - Bookings controllers.
 * @param {object} auth - Auth middleware ({ requireAccount, requireAdmission,
 *   requireAccountOrAdmission, requireServiceKey }).
 * @returns {import('express').Router} Express bookings router.
 */
function createBookingsRouter(controller, auth) {
  const router = express.Router();
  router.post('/v1/core/bookings', auth.requireAccount, auth.requireAdmission, controller.createBooking);
  router.get('/v1/core/bookings/active', auth.requireAccount, controller.listActiveBookings);
  router.get('/v1/core/bookings/:bookingId', auth.requireAccountOrAdmission, controller.getBooking);
  router.post('/v1/core/bookings/:bookingId/payment', auth.requireAccountOrAdmission, controller.enterPayment);
  router.post('/v1/core/bookings/:bookingId/check-status', auth.requireAccountOrAdmission, controller.checkStatus);
  // Internal: payment-module -> core (notifyPaymentResult, LLD-03 §5.3).
  router.post('/v1/internal/bookings/:bookingId/payment-result', auth.requireServiceKey, controller.paymentResult);
  return router;
}

module.exports = { createBookingsRouter };
