/**
 * Creates controllers for the admin booking endpoints (LLD-05 §6).
 *
 * @param {object} bookingsUseCase - Booking use case.
 * @returns {object} Booking endpoint controllers.
 */
function createBookingsController(bookingsUseCase) {
  return {
    getBooking: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const booking = await bookingsUseCase.getBooking(request.params.bookingId, request.admin);
      response.status(200).json(booking);
    },

    listRefundFlags: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const flags = await bookingsUseCase.listRefundFlags(request.query.eventId);
      response.status(200).json(flags);
    }
  };
}

module.exports = { createBookingsController };
