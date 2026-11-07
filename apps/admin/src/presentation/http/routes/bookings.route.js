const express = require('express');
const { wrapController } = require('@/presentation/http/middleware/async-handler');

/**
 * Creates the admin booking router (LLD-05 §6.1–§6.2). Admin-only.
 *
 * @param {object} controller - Booking endpoint controllers.
 * @returns {import('express').Router} Express admin booking router.
 */
function createBookingsRouter(controller) {
  const c = wrapController(controller);
  const router = express.Router();
  router.get('/bookings/:bookingId', c.getBooking);
  router.get('/refund-flags', c.listRefundFlags);
  return router;
}

module.exports = { createBookingsRouter };
