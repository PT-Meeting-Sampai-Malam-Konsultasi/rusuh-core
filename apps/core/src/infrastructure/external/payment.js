/**
 * Payment-module internal client (LLD-03 contract, private network).
 *  POST {baseUrl}/internal/snap { bookingId, attempt, orderId, grossAmount, itemDetails }
 *    -> { orderId, snapToken, redirectUrl }
 *  GET {baseUrl}/internal/status/{orderId}
 *    -> { status: 'settlement'|'capture'|'pending'|'deny'|'cancel'|'expire'|'failure',
 *         grossAmount, transactionId, paymentType }
 * When baseUrl is not configured the client runs in stub mode (local dev):
 * createSnap returns a fake snap token and getStatus returns "pending"
 * unless the caller injected a stub. Stub mode is logged by the caller.
 */

class PaymentClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] - Payment-module internal base URL.
   * @param {string} [options.serviceKey] - Shared service credential header.
   * @param {number} [options.timeoutMs] - Per-call timeout (default 5000).
   * @param {Function} [options.fetchImpl] - fetch implementation (tests inject a stub).
   */
  constructor({ baseUrl, serviceKey, timeoutMs = 5000, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, '') : null;
    this.serviceKey = serviceKey || null;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  get isStub() {
    return !this.baseUrl;
  }

  async _call(path, { method = 'GET', body } = {}) {
    if (this.isStub) throw new Error('PaymentClient is in stub mode (no PAYMENT_URL)');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(this.serviceKey ? { 'x-service-key': this.serviceKey } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`Payment-module responded ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Creates a Snap transaction for one attempt.
   *
   * @param {object} input
   * @param {string} input.bookingId
   * @param {number} input.attempt
   * @param {string} input.orderId - {booking_id}-{attempt} (ADR-0008).
   * @param {number} input.grossAmount - Server-side total (IDR).
   * @param {Array} input.itemDetails - Midtrans item_details lines.
   * @returns {Promise<{orderId: string, snapToken: string, redirectUrl: string}>}
   */
  async createSnap({ bookingId, attempt, orderId, grossAmount, itemDetails }) {
    if (this.isStub) {
      return {
        orderId,
        snapToken: `stub-snap-${bookingId}-${attempt}`,
        redirectUrl: `https://pay.rusuh.id/start?order_id=${orderId}`
      };
    }
    return this._call('/internal/snap', {
      method: 'POST',
      body: { bookingId, attempt, orderId, grossAmount, itemDetails }
    });
  }

  /**
   * Gets the Midtrans status of one order (Get Status, ADR-0008).
   * 404 means "no transaction yet" (normal before a method is chosen).
   *
   * @param {string} orderId
   * @returns {Promise<{status: string, grossAmount: number, transactionId: string|null, paymentType: string|null}|null>}
   *   Null when the order has no transaction yet (404).
   */
  async getStatus(orderId) {
    if (this.isStub) return { status: 'pending', grossAmount: 0, transactionId: null, paymentType: null };
    try {
      return await this._call(`/internal/status/${encodeURIComponent(orderId)}`);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Best-effort expire of one order (sweeper; 412 already expired/settled is ignored).
   *
   * @param {string} orderId
   * @returns {Promise<void>}
   */
  async expire(orderId) {
    if (this.isStub) return;
    try {
      await this._call(`/internal/expire/${encodeURIComponent(orderId)}`, { method: 'POST' });
    } catch (error) {
      if (error.status === 412) return;
      throw error;
    }
  }
}

module.exports = { PaymentClient };
