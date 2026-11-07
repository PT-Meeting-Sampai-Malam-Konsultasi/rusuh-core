/**
 * Internal client for core-module (LLD-03 §5.3). Core-module is called over the
 * private network with a service credential (mTLS + header, §2) — never with an
 * account JWT. The transport here is plain HTTPS + a service credential header;
 * the exact mechanism (internal ALB vs Cloud Map) is an infra decision (LLD-03
 * §11 item 1). The endpoint path below is the contract this module assumes;
 * core-module implements it (LLD-02 §5).
 *
 * notifyPaymentResult is idempotent on the core side (guard status + dedup),
 * so a retry with the same transaction_status yields the same result.
 */

class CoreClientError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'CoreClientError';
    this.status = status;
  }
}

/**
 * Creates a core-module client.
 *
 * @param {object} options - Client options.
 * @param {string} options.baseUrl - Core-module internal base URL.
 * @param {string} [options.credential] - Service credential (header value).
 * @param {number} [options.timeoutMs] - Per-attempt timeout (default 5000).
 * @param {Function} [options.fetchImpl] - Fetch implementation (default global fetch).
 * @returns {object} Core client.
 */
function createCoreClient({ baseUrl, credential, timeoutMs = 5000, fetchImpl = fetch } = {}) {
  if (!baseUrl) throw new Error('createCoreClient requires a baseUrl');

  return {
    /**
     * Notifies core-module of a confirmed payment result.
     *
     * @param {object} input - Confirmed payment result.
     * @param {string} input.bookingId - Booking id (prefix of order_id).
     * @param {string} input.orderId - Midtrans order_id ({booking_id}-{attempt}).
     * @param {string} input.transactionId - Midtrans transaction id.
     * @param {string} input.transactionStatus - Confirmed Midtrans status.
     * @param {string} [input.paymentType] - Midtrans payment_type.
     * @param {number} input.grossAmount - Confirmed gross amount (IDR).
     * @returns {Promise<object>} { bookingStatus, actionTaken }.
     */
    async notifyPaymentResult({ bookingId, orderId, transactionId, transactionStatus, paymentType, grossAmount }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/internal/payments/notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(credential ? { 'X-Service-Credential': credential } : {})
          },
          body: JSON.stringify({
            booking_id: bookingId,
            order_id: orderId,
            transaction_id: transactionId,
            transaction_status: transactionStatus,
            payment_type: paymentType,
            gross_amount: grossAmount
          }),
          signal: controller.signal
        });
      } catch (error) {
        throw new CoreClientError(`Core notify failed: ${error.message}`);
      } finally {
        clearTimeout(timer);
      }

      let data = null;
      try {
        data = await response.json();
      } catch (_error) {
        data = null;
      }
      if (!response.ok) {
        throw new CoreClientError(`Core notify responded ${response.status}`, response.status);
      }
      return { bookingStatus: data?.booking_status, actionTaken: data?.action_taken, raw: data };
    }
  };
}

module.exports = { createCoreClient, CoreClientError };
