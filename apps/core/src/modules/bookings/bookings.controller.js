const { problemError } = require('@/lib/problem');
const { presentBooking, serverNow } = require('@/lib/presenters');
const { createBookingBody, bookingIdParam, paymentResultBody } = require('./bookings.validation');

/**
 * Creates controllers for the booking endpoints.
 *
 * @param {object} service - Booking service.
 * @returns {object} Booking endpoint controllers.
 */
function createBookingsController(service) {
  return {
    createBooking: async (request, response, next) => {
      try {
        const { error, value } = createBookingBody.validate(request.body);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const { booking, created } = await service.createBooking(request.account, request.admission, value);
        response.locals.skipResponseEnvelope = true;
        response.status(created ? 201 : 200).json(presentBooking(booking));
      } catch (err) {
        next(err);
      }
    },

    listActiveBookings: async (request, response, next) => {
      try {
        const bookings = await service.listActiveBookings(request.account.sub);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json({ items: bookings.map(presentBooking) });
      } catch (err) {
        next(err);
      }
    },

    getBooking: async (request, response, next) => {
      try {
        const { error } = bookingIdParam.validate(request.params);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const booking = await service.getBooking(request.params.bookingId, {
          account: request.account,
          admission: request.admission
        });
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(presentBooking(booking));
      } catch (err) {
        next(err);
      }
    },

    enterPayment: async (request, response, next) => {
      try {
        const { error } = bookingIdParam.validate(request.params);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const result = await service.enterPayment(request.params.bookingId, {
          account: request.account,
          admission: request.admission
        });
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },

    checkStatus: async (request, response, next) => {
      try {
        const { error } = bookingIdParam.validate(request.params);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const booking = await service.checkStatus(request.params.bookingId, {
          account: request.account,
          admission: request.admission
        });
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(presentBooking(booking));
      } catch (err) {
        next(err);
      }
    },

    /**
     * Internal payment-result endpoint (notifyPaymentResult, LLD-03 §5.3).
     * Called by payment-module over the private network with a service key.
     * Not part of the public API.
     */
    paymentResult: async (request, response, next) => {
      try {
        const { error: paramError } = bookingIdParam.validate(request.params);
        if (paramError) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const { error, value } = paymentResultBody.validate(request.body);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const result = await service.confirmPayment(request.params.bookingId, value);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json({ ...result, serverNow: serverNow() });
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createBookingsController };
