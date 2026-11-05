const Boom = require('@hapi/boom');
const { createSnapSchema } = require('./snap.validation');

/** Snap expiry: blanket 10 minutes from payment entry P (ADR-0026, no grace). */
const SNAP_EXPIRY_MINUTES = 10;

/**
 * Creates the Snap service (internal operation, LLD-03 §4.1).
 * Core-module calls createSnapTransaction over the private network; the
 * endpoint is NOT public. Re-create = a NEW attempt (old token NOT revoked).
 */
function createSnapService({ store, midtransClient, metrics, logger } = {}) {
  if (!store) throw new Error('createSnapService requires a store');
  if (!midtransClient) throw new Error('createSnapService requires a midtransClient');

  return {
    /**
     * Creates a Snap transaction for a booking (attempt = existing attempts + 1).
     *
     * @param {object} input - Snap inputs.
     * @param {string} input.bookingId - Booking id.
     * @param {number} input.grossAmount - Server-side total (IDR, integer).
     * @param {object[]} input.itemDetails - Item lines (per category + fees).
     * @param {object} [input.customerDetails] - { email, firstName } for prefill.
     * @param {Date|string} input.snapStartTime - Booking created_at (payment entry P).
     * @param {string} [input.method] - Requested payment method (wrapper page choice).
     * @param {object} [input.callbacks] - { finish, unfinish, error } redirect URLs.
     * @returns {Promise<object>} { orderId, attempt, snapToken, redirectUrl, gatewayExpiresAt }.
     */
    async createSnapTransaction(input) {
      const { error, value } = createSnapSchema.validate(input);
      if (error) throw Boom.badRequest(`Invalid createSnapTransaction input: ${error.message}`);
      const { bookingId, grossAmount, itemDetails, customerDetails, snapStartTime, method, callbacks } = value;

      const existing = await store.getPaymentOrdersByBooking(bookingId);
      const attempt = existing.length + 1;
      const orderId = `${bookingId}-${attempt}`;
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

module.exports = { createSnapService, SNAP_EXPIRY_MINUTES };
