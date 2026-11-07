/**
 * Pure payment-domain rules (no I/O, no dependencies).
 *
 * These are the business rules the webhook use case applies to a confirmed
 * Midtrans notification: order_id parsing ({booking_id}-{attempt}), the
 * exact-amount integrity check, the Midtrans-to-order status mapping, and
 * the "is this a successful payment" decision (ADR-0008). They live in the
 * domain so both the application layer and tests can use them without
 * touching infrastructure.
 */

/**
 * Extracts the booking id from a Midtrans order_id ({booking_id}-{attempt}).
 * The booking id itself never contains a hyphen, so the last hyphen splits it.
 *
 * @param {string} orderId - Midtrans order_id.
 * @returns {string|null} Booking id, or null when the order_id is malformed.
 */
function parseBookingId(orderId) {
  if (typeof orderId !== 'string') return null;
  const index = orderId.lastIndexOf('-');
  if (index <= 0) return null;
  return orderId.slice(0, index);
}

/**
 * Compares a Midtrans gross_amount string ("1505000.00") with the server total
 * (integer IDR). Both must be exactly equal — a mismatch is an integrity anomaly.
 *
 * @param {string|number} grossAmount - Midtrans gross_amount.
 * @param {number} serverTotal - payment_orders.gross_amount.
 * @returns {boolean} True when equal.
 */
function amountEquals(grossAmount, serverTotal) {
  const value = Number(grossAmount);
  return Number.isFinite(value) && value === serverTotal;
}

/**
 * Maps a confirmed Midtrans status to a payment_orders status.
 *
 * @param {string} transactionStatus - Confirmed Midtrans status.
 * @returns {string} payment_orders status.
 */
function mapOrderStatus(transactionStatus) {
  switch (transactionStatus) {
    case 'capture':
    case 'settlement':
      return 'settled';
    case 'expire':
      return 'expired';
    case 'deny':
    case 'cancel':
    case 'failure':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Decides whether a confirmed status is a successful payment (ADR-0008).
 * settlement always succeeds; capture only with an accepted fraud status
 * (fraud_status is absent for non-card methods, which counts as accepted).
 *
 * @param {string} transactionStatus - Confirmed Midtrans status.
 * @param {string|null} fraudStatus - Confirmed fraud_status.
 * @returns {boolean} True when the payment succeeded.
 */
function isFinalSuccess(transactionStatus, fraudStatus) {
  if (transactionStatus === 'settlement') return true;
  if (transactionStatus === 'capture')
    return fraudStatus === null || fraudStatus === undefined || fraudStatus === 'accept';
  return false;
}

module.exports = { parseBookingId, amountEquals, mapOrderStatus, isFinalSuccess };
