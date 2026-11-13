/**
 * CoreClient port (domain/ports).
 *
 * The internal core-module contract the webhook use case depends on
 * (LLD-03 §5.3). Core-module is called over the private network with a
 * service credential — never with an account JWT. notifyPaymentResult is
 * idempotent on the core side (guard status + dedup), so a retry with the
 * same transaction_status yields the same result.
 *
 * @typedef {object} NotifyPaymentResultInput
 * @property {string} bookingId - Booking id (prefix of order_id).
 * @property {string} orderId - Midtrans order_id ({booking_id}-{attempt}).
 * @property {string} transactionId - Midtrans transaction id.
 * @property {string} transactionStatus - Confirmed Midtrans status.
 * @property {string} [paymentType] - Midtrans payment_type.
 * @property {number} grossAmount - Confirmed gross amount (IDR).
 *
 * @typedef {object} NotifyPaymentResult
 * @property {boolean} handled - False when core deliberately changed nothing (deterministic, never retried).
 * @property {boolean} late - True when the booking was already EXPIRED/CANCELLED (refund flagged by core).
 * @property {boolean} duplicate - True when the result was already applied.
 * @property {string|null} reason - Why core did not act (not_found, not_held, amount_mismatch, not_confirmed).
 * @property {string} [actionTaken] - 'paid_after_expiry' when late.
 *
 * @typedef {object} CoreClient
 * @property {function(NotifyPaymentResultInput): Promise<NotifyPaymentResult>} notifyPaymentResult
 */

module.exports = {};
