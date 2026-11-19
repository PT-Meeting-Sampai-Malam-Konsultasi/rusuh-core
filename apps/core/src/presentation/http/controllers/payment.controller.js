const { problemError } = require('@/domain/problem');
const { serverNow } = require('@/domain/presenters');
const { bookingIdParam } = require('../validation/bookings.validation');

/**
 * Creates the public payment facade controllers. The facade owns the
 * browser-facing `/v1/payment` contract while the payment service remains an
 * internal Midtrans adapter.
 *
 * @param {object} options - Facade dependencies.
 * @param {object} options.bookings - Booking use case.
 * @param {object} options.store - Event lookup port.
 * @param {string|null} options.snapClientKey - Browser-safe Midtrans client key.
 * @returns {object} Public payment facade controllers.
 */
function createPaymentController({ bookings, store, snapClientKey }) {
  /** Validates a booking id path parameter before invoking the use case. */
  function bookingIdOf(request) {
    const { error } = bookingIdParam.validate(request.params);
    if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
    return request.params.bookingId;
  }

  /** Resolves the authenticated caller shape expected by the booking use case. */
  function callerOf(request) {
    return { account: request.account, admission: request.admission };
  }

  /** Rejects a booking that can no longer enter or remain in the payment flow. */
  function requirePaymentable(booking) {
    if (booking.status !== 'SELECTION' && booking.status !== 'PAYMENT_PENDING') {
      throw problemError('BOOKING_NOT_HELD', 'The booking is paid, expired or cancelled.');
    }
  }

  return {
    /**
     * Returns the payment-page view for an authenticated booking owner.
     *
     * @param {import('express').Request} request - Request containing booking id and account.
     * @param {import('express').Response} response - Express response.
     * @param {Function} next - Express error continuation.
     * @returns {Promise<void>} Completes the JSON response.
     */
    async getPaymentPage(request, response, next) {
      try {
        const booking = await bookings.getBooking(bookingIdOf(request), callerOf(request));
        requirePaymentable(booking);
        const event = await store.getEvent(booking.eventId);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json({
          bookingId: booking.bookingId,
          orderCode: booking.orderCode,
          eventName: event?.name || null,
          eventStartsAt: event?.startsAt || null,
          venueShort: event?.venueShort || null,
          timezone: event?.timezone || 'Asia/Jakarta',
          attendees: booking.attendees.map((attendee) => ({
            categoryId: attendee.categoryId,
            categoryName: attendee.categoryName,
            fullName: attendee.fullName,
            nikMasked: attendee.nikMasked
          })),
          price: booking.price,
          currentSnap:
            booking.status === 'PAYMENT_PENDING' && booking.snapToken
              ? {
                  attemptId: booking.attempt || 1,
                  orderId: `${booking.bookingId}-${booking.attempt || 1}`,
                  method: null,
                  snapToken: booking.snapToken,
                  redirectUrl: booking.redirectUrl || null,
                  gatewayExpiresAt: booking.paymentExpiresAt
                }
              : null,
          expiresAt: booking.paymentExpiresAt || booking.expiresAt,
          serverNow: serverNow(),
          snapClientKey: snapClientKey || null
        });
      } catch (error) {
        next(error);
      }
    },

    /**
     * Creates or returns the Snap transaction for an authenticated booking owner.
     *
     * @param {import('express').Request} request - Request containing booking id and account.
     * @param {import('express').Response} response - Express response.
     * @param {Function} next - Express error continuation.
     * @returns {Promise<void>} Completes the JSON response.
     */
    async startSnap(request, response, next) {
      try {
        const bookingId = bookingIdOf(request);
        const result = await bookings.enterPayment(bookingId, callerOf(request));
        const booking = await bookings.getBooking(bookingId, callerOf(request));
        const attempt = booking.attempt || 1;
        response.locals.skipResponseEnvelope = true;
        response.status(201).json({
          attemptId: attempt,
          orderId: `${result.bookingId}-${attempt}`,
          method: null,
          snapToken: result.snapToken,
          redirectUrl: result.redirectUrl || null,
          gatewayExpiresAt: result.paymentExpiresAt
        });
      } catch (error) {
        next(error);
      }
    },

    /**
     * Polls Midtrans through the booking owner and returns payment-module status.
     *
     * @param {import('express').Request} request - Request containing booking id and account.
     * @param {import('express').Response} response - Express response.
     * @param {Function} next - Express error continuation.
     * @returns {Promise<void>} Completes the JSON response.
     */
    async getPaymentStatus(request, response, next) {
      try {
        const booking = await bookings.checkStatus(bookingIdOf(request), callerOf(request));
        const paymentStatuses = {
          PAID: 'settled',
          PAYMENT_PENDING: 'pending',
          EXPIRED: 'expired',
          CANCELLED: 'cancelled'
        };
        const paymentStatus = paymentStatuses[booking.status] || 'none';
        response.locals.skipResponseEnvelope = true;
        response.status(200).json({ bookingStatus: booking.status, paymentStatus, serverNow: serverNow() });
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = { createPaymentController };
