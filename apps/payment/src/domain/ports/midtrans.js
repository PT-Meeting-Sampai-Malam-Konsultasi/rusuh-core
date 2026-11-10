/**
 * MidtransClient port (domain/ports).
 *
 * The gateway contract the use cases depend on. The infrastructure layer
 * implements it with Node's built-in fetch (see
 * infrastructure/external/midtrans/midtrans-client.js); the use cases only
 * ever see this shape. All calls use the Server Key (Basic Auth,
 * backend-only).
 *
 * @typedef {object} SnapResult
 * @property {string} token - Snap token (redirect URL is built from it).
 * @property {string} redirectUrl - Snap redirect URL.
 *
 * @typedef {object} MidtransStatus
 * @property {string} order_id
 * @property {string} transaction_id
 * @property {string} transaction_status
 * @property {string} [fraud_status]
 * @property {string} [payment_type]
 * @property {string} gross_amount
 * @property {string} status_code
 * @property {string} [currency]
 *
 * @typedef {object} MidtransClient
 * @property {function(object): Promise<SnapResult>} createSnap
 * @property {function(string): Promise<MidtransStatus>} getStatus
 * @property {function(string): Promise<object>} expire
 */

/**
 * Error thrown by the Midtrans client. `status` is the HTTP status when
 * known (404 = Get Status transaction not found, 412 = already
 * expired/settled). Defined here — in the domain — so the application layer
 * can distinguish gateway failures (e.g. GET_STATUS_NOT_FOUND) without
 * importing the infrastructure adapter.
 */
class MidtransError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'MidtransError';
    this.status = status;
  }
}

module.exports = { MidtransError };
