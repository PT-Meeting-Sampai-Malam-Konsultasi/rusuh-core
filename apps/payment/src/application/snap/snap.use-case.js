const Boom = require('@hapi/boom');
const { createSnapSchema } = require('./snap.validation');

/** Snap expiry: blanket 10 minutes from payment entry P (ADR-0026, no grace). */
const SNAP_EXPIRY_MINUTES = 10;

/**
 * Creates the Snap use case (internal operation, LLD-03 §4.1).
 * Core-module calls createSnapTransaction over the private network; the
 * endpoint is NOT public. Re-create = a NEW attempt (old token NOT revoked).
 * Core owns `attempt` and `orderId` (it derives the order id again for Get
 * Status and Expire); this module only checks they agree (ADR-0008).
 */
function createSnapUseCase({ store, midtransClient, metrics, logger } = {}) {
  if (!store) throw new Error('createSnapUseCase requires a store');
  if (!midtransClient) throw new Error('createSnapUseCase requires a midtransClient');

  return {
    /**
     * Creates a Snap transaction for one attempt of a booking.
     *
     * @param {object} input - Snap inputs.
     * @param {string} input.bookingId - Booking id.
     * @param {number} input.attempt - Attempt number, owned by core-module.
     * @param {string} input.orderId - Must equal `{bookingId}-{attempt}` (ADR-0008).
     * @param {number} input.grossAmount - Server-side total (IDR, integer).
     * @param {object[]} input.itemDetails - Item lines (per category + fees).
     * @param {object} [input.customerDetails] - { email, firstName } for prefill.
     * @param {Date|string} input.snapStartTime - Booking created_at (payment entry P).
     * @param {string} [input.method] - Requested payment method (wrapper page choice).
     * @param {object} [input.callbacks] - { finish, unfinish, error } redirect URLs.
     * @returns {Promise<object>} { orderId, attempt, snapToken, redirectUrl, gatewayExpiresAt }.
     * @throws {Boom} 400 on invalid input or an orderId that does not match bookingId + attempt; 409 on a duplicate orderId.
     */
    async createSnapTransaction(input) {
      const { error, value } = createSnapSchema.validate(input);
      if (error) throw Boom.badRequest(`Invalid createSnapTransaction input: ${error.message}`);
      const {
        bookingId,
        attempt,
        orderId,
        grossAmount,
        itemDetails,
        customerDetails,
        snapStartTime,
        method,
        callbacks
      } = value;
      if (orderId !== `${bookingId}-${attempt}`) {
        throw Boom.badRequest('Invalid createSnapTransaction input: orderId must equal {bookingId}-{attempt}');
      }

      const existing = await store.getPaymentOrdersByBooking(bookingId);
      if (existing.some((order) => order.orderId === orderId)) {
        throw Boom.conflict(`Order ${orderId} already exists`);
      }
      // Re-create inherits the ORIGINAL snap_start_time from attempt 1 (§4.4):
      // a new attempt must not extend the P+10 payment window.
      const startTime = existing.length > 0 ? existing[0].snapStartTime : snapStartTime;

      await store.createPaymentOrder({ orderId, bookingId, attempt, grossAmount, snapStartTime: startTime });

      let snap;
      try {
        snap = await midtransClient.createSnap({
          orderId,
          grossAmount,
          itemDetails,
          customerDetails,
          startTime,
          method,
          callbacks
        });
      } catch (requestError) {
        // Snap creation failed: the order row stays "created" (core retries with
        // a NEW attempt; the old attempt token is never revoked, §4.4/§9).
        metrics?.increment?.('midtrans_5xx_count');
        logger
          ?.addTags?.(['snap', 'create-failed'])
          ?.addData?.({ bookingId, orderId, error: requestError.message })
          ?.error?.('Snap creation failed');
        throw requestError;
      }

      await store.updatePaymentOrder(orderId, { status: 'pending' });
      metrics?.increment?.('snap_created');
      logger
        ?.addTags?.(['snap', 'created'])
        ?.addData?.({ bookingId, orderId, attempt })
        ?.info?.('Snap transaction created');

      const gatewayExpiresAt = new Date(new Date(startTime).getTime() + SNAP_EXPIRY_MINUTES * 60 * 1000);
      return { orderId, attempt, snapToken: snap.token, redirectUrl: snap.redirectUrl, gatewayExpiresAt };
    }
  };
}

module.exports = { createSnapUseCase, SNAP_EXPIRY_MINUTES };
