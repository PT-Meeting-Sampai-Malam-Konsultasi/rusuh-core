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
 * @property {string} [bookingStatus] - Core booking status after the notify.
 * @property {string} [actionTaken] - Core action (e.g. paid, paid_after_expiry).
 * @property {object} [raw] - Raw core response body.
 *
 * @typedef {object} CoreClient
 * @property {function(NotifyPaymentResultInput): Promise<NotifyPaymentResult>} notifyPaymentResult
 */

module.exports = {};
