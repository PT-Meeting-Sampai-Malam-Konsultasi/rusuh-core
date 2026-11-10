/**
 * PaymentStore port (domain/ports).
 *
 * The persistence contract the use cases depend on. The infrastructure
 * layer implements it twice (in-memory for dev/test, Postgres for
 * production — see infrastructure/persistence/store.js); the use cases only
 * ever see this shape, never a pg Pool or a Map.
 *
 * @typedef {object} PaymentOrder
 * @property {string} orderId - Midtrans order_id ({booking_id}-{attempt}).
 * @property {string} bookingId - Booking id (prefix of order_id).
 * @property {number} attempt - Snap attempt number (1-based).
 * @property {number} grossAmount - Server-side total (IDR, integer).
 * @property {string} status - created | pending | settled | expired | failed.
 * @property {Date} snapStartTime - Booking created_at (payment entry P).
 * @property {string|null} paymentType - Midtrans payment_type.
 * @property {Date} createdAt
 * @property {Date} updatedAt
 *
 * @typedef {object} PaymentAttempt
 * @property {string} id
 * @property {string} orderId
 * @property {string} bookingId
 * @property {string} transactionId - Midtrans transaction_id (UNIQUE).
 * @property {string} transactionStatus - Confirmed Midtrans status.
 * @property {string|null} paymentType
 * @property {number|null} grossAmount
 * @property {boolean} confirmed - True once confirmed via Get Status.
 * @property {object|null} rawPayload - Original webhook JSON.
 * @property {Date} receivedAt
 * @property {Date} updatedAt
 *
 * @typedef {object} CallbackLog
 * @property {string} id
 * @property {string|null} orderId
 * @property {string|null} bookingId
 * @property {boolean} signatureValid
 * @property {string|null} transactionStatus
 * @property {Date} receivedAt
 *
 * @typedef {object} PaymentStore
 * @property {function(object): Promise<PaymentOrder>} createPaymentOrder
 * @property {function(string): Promise<PaymentOrder[]>} getPaymentOrdersByBooking
 * @property {function(string): Promise<PaymentOrder|null>} getPaymentOrder
 * @property {function(string, object): Promise<PaymentOrder|null>} updatePaymentOrder
 * @property {function(string): Promise<PaymentAttempt|null>} findPaymentAttempt
 * @property {function(object): Promise<PaymentAttempt>} createPaymentAttempt
 * @property {function(object): Promise<PaymentAttempt>} upsertPaymentAttempt
 * @property {function(object): Promise<CallbackLog>} createCallbackLog
 * @property {function(object): Promise<CallbackLog[]>} getCallbackLogs
 * @property {function(): Promise<void>} close
 */

module.exports = {};
