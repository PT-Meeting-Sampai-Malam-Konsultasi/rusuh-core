/**
 * Creates controllers for the admin booking endpoints (LLD-05 §6).
 *
 * @param {object} bookingsService - Booking service.
 * @returns {object} Booking endpoint controllers.
 */
function createBookingsController(bookingsService) {
  return {
    getBooking: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const booking = await bookingsService.getBooking(request.params.bookingId, request.admin);
      response.status(200).json(booking);
    },

    listRefundFlags: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const flags = await bookingsService.listRefundFlags(request.query.eventId);
      response.status(200).json(flags);
    }
  };
}

module.exports = { createBookingsController };
