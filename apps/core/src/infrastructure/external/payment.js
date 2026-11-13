/**
 * Payment-module internal client (LLD-03 contract, private network, ADR-0028 prefix).
 *  POST {baseUrl}/v1/internal/payments/snap { bookingId, attempt, orderId, grossAmount, itemDetails, snapStartTime }
 *    -> { orderId, snapToken, redirectUrl }
 *  GET {baseUrl}/v1/internal/payments/orders/{orderId}/status
 *    -> { status: 'settlement'|'capture'|'pending'|'deny'|'cancel'|'expire'|'failure',
 *         grossAmount, transactionId, paymentType }
 *  POST {baseUrl}/v1/internal/payments/orders/{orderId}/expire
 * Every call carries the shared credential in the x-service-key header.
 * When baseUrl is not configured the client runs in stub mode (local dev):
 * createSnap returns a fake snap token and getStatus returns "pending"
 * unless the caller injected a stub. Stub mode is logged by the caller.
 */

const { createOutboundHeaders, reportHttpFailure } = require('@rusuh/observability');

class PaymentClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] - Payment-module internal base URL.
   * @param {string} [options.serviceKey] - Shared service credential header.
   * @param {number} [options.timeoutMs] - Per-call timeout (default 5000).
   * @param {Function} [options.fetchImpl] - fetch implementation (tests inject a stub).
   * @param {object} [options.logger] - Structured logger used to record dependency failures.
   */
  constructor({ baseUrl, serviceKey, timeoutMs = 5000, fetchImpl = fetch, logger } = {}) {
    this.logger = logger;
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, '') : null;
    this.serviceKey = serviceKey || null;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  get isStub() {
    return !this.baseUrl;
  }

  /**
   * Performs one internal HTTP call and records a failure through
   * reportHttpFailure (allowlisted fields only: no URL, headers or body).
   *
   * @param {string} path - Path under the payment base URL.
   * @param {object} [options]
   * @param {string} [options.method] - HTTP method (default GET).
   * @param {object} [options.body] - JSON body.
   * @param {string} [options.operation] - Safe operation name used in the failure log.
   * @param {number[]} [options.expectedStatuses] - Non-2xx statuses that are normal outcomes and not logged.
   * @returns {Promise<object>} Parsed JSON body.
   * @throws {Error} With `status` set when payment answered non-2xx.
   */
  async _call(path, { method = 'GET', body, operation = 'call', expectedStatuses = [] } = {}) {
    if (this.isStub) throw new Error('PaymentClient is in stub mode (no PAYMENT_URL)');
    const controller = new AbortController();
    let timedOut = false;
    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: createOutboundHeaders({
          'content-type': 'application/json',
          ...(this.serviceKey ? { 'x-service-key': this.serviceKey } : {})
        }),
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`Payment-module responded ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (!expectedStatuses.includes(error.status)) {
        reportHttpFailure({ logger: this.logger, service: 'payment', operation, error, timedOut, startedAt });
      }
      throw error;
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
   * @param {string} input.snapStartTime - Booking createdAt (ISO), the payment window origin (LLD-03 §4.1).
   * @returns {Promise<{orderId: string, snapToken: string, redirectUrl: string}>}
   */
  async createSnap({ bookingId, attempt, orderId, grossAmount, itemDetails, snapStartTime }) {
    if (this.isStub) {
      return {
        orderId,
        snapToken: `stub-snap-${bookingId}-${attempt}`,
        redirectUrl: `https://pay.rusuh.id/start?order_id=${orderId}`
      };
    }
    return this._call('/v1/internal/payments/snap', {
      method: 'POST',
      operation: 'createSnap',
      body: { bookingId, attempt, orderId, grossAmount, itemDetails, snapStartTime }
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
      return await this._call(`/v1/internal/payments/orders/${encodeURIComponent(orderId)}/status`, {
        operation: 'getStatus',
        expectedStatuses: [404]
      });
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
      await this._call(`/v1/internal/payments/orders/${encodeURIComponent(orderId)}/expire`, {
        method: 'POST',
        operation: 'expire',
        expectedStatuses: [412]
      });
    } catch (error) {
      if (error.status === 412) return;
      throw error;
    }
  }
}

module.exports = { PaymentClient };
