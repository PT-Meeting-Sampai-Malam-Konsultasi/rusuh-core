/**
 * Internal client for core-module (LLD-03 §5.3). Core-module is called over the
 * private network (Service Connect) with the shared service credential in the
 * x-service-key header — never with an account JWT. mTLS is NOT applied yet;
 * the credential is the only service-to-service control today.
 *
 * Contract (ADR-0028 internal prefix, implemented by core in LLD-02 §5):
 *   POST {baseUrl}/v1/internal/bookings/{bookingId}/payment-result
 *   body { orderId, transactionId, transactionStatus, paymentType, grossAmount }
 *   200 { handled, duplicate?, late?, reason?, ... }
 *
 * notifyPaymentResult is idempotent on the core side (guard status + dedup),
 * so a retry with the same transactionStatus yields the same result.
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
     * @param {string} input.bookingId - Booking id (prefix of orderId), sent in the path.
     * @param {string} input.orderId - Midtrans order_id ({booking_id}-{attempt}).
     * @param {string} input.transactionId - Midtrans transaction id.
     * @param {string} input.transactionStatus - Confirmed Midtrans status.
     * @param {string} [input.paymentType] - Midtrans payment_type.
     * @param {number} input.grossAmount - Confirmed gross amount (IDR).
     * @returns {Promise<{handled: boolean, late: boolean, duplicate: boolean, reason: string|null, actionTaken: string|undefined}>}
     *   Only the fields payment needs; the booking body core returns is dropped.
     * @throws {CoreClientError} On a transport failure, a non-2xx status or a 2xx body that is not a JSON object.
     */
    async notifyPaymentResult({ bookingId, orderId, transactionId, transactionStatus, paymentType, grossAmount }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/internal/bookings/${encodeURIComponent(bookingId)}/payment-result`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(credential ? { 'x-service-key': credential } : {})
          },
          body: JSON.stringify({ orderId, transactionId, transactionStatus, paymentType, grossAmount }),
          signal: controller.signal
        });
      } catch (error) {
        throw new CoreClientError(`Core notify failed: ${error.message}`);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new CoreClientError(`Core notify responded ${response.status}`, response.status);
      }
      let data = null;
      try {
        data = await response.json();
      } catch (_error) {
        data = null;
      }
      if (!data || typeof data !== 'object' || typeof data.handled !== 'boolean') {
        throw new CoreClientError('Core notify returned an unreadable body', response.status);
      }
      return {
        handled: data.handled,
        late: data.late === true,
        duplicate: data.duplicate === true,
        reason: typeof data.reason === 'string' ? data.reason : null,
        actionTaken: data.late === true ? 'paid_after_expiry' : undefined
      };
    }
  };
}

module.exports = { createCoreClient, CoreClientError };
