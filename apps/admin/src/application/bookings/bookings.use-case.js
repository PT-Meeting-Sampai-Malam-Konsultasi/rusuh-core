const { ApiError } = require('@/domain/errors');

/**
 * Admin booking use case (LLD-05 §6.1–§6.2). Booking detail always returns
 * masked NIK; full NIK is only available through the reveal endpoint
 * (not in this story's scope — see report). Refund flags are read-only:
 * finance refunds outside the system (ADR-0009).
 *
 * @param {import('@/domain/ports/store.port').AdminStore} store - Store with getBooking/listRefundFlags.
 * @param {object} audit - Audit use case.
 * @returns {object} Booking operations.
 */
function createBookingsUseCase(store, audit) {
  return {
    async getBooking(bookingId, actor) {
      const booking = await store.getBooking(bookingId);
      if (!booking) throw new ApiError('NOT_FOUND', `Booking ${bookingId} not found`);
      await audit.record({ actor, action: 'BOOKING_VIEWED', bookingId, eventId: booking.event_id });
      return booking;
    },

    async listRefundFlags(eventId) {
      const flags = await store.listRefundFlags(eventId);
      return { items: flags };
    }
  };
}

module.exports = { createBookingsUseCase };
