const { MidtransError } = require('@/domain/ports/midtrans');

/**
 * Midtrans HTTP client (Node built-in fetch). All calls use the Server Key
 * (Basic Auth, backend-only). The fetch implementation is injectable so tests
 * run without a live Midtrans sandbox.
 *
 * Snap create: POST {snapBaseUrl}/v1/transactions
 * Get Status:  GET  {apiBaseUrl}/v2/{order_id}/status
 * Expire:      POST {apiBaseUrl}/v2/{order_id}/expire
 */
// Match the enabled Sandbox Snap channels used in the demo: VA plus QRIS.
const ENABLED_PAYMENTS = Object.freeze(['bca_va', 'echannel', 'bni_va', 'bri_va', 'qris']);

/**
 * Formats a Date as a Midtrans expiry start_time: "YYYY-MM-DD HH:mm:ss +0700" (WIB).
 *
 * @param {Date|string} value - Booking created_at (payment entry P).
 * @returns {string} Formatted start_time.
 */
function formatMidtransTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  // WIB is UTC+7; format in that offset regardless of the host timezone.
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())} ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}:${pad(wib.getUTCSeconds())} +0700`;
}

/**
 * Creates a Midtrans client.
 *
 * @param {object} options - Client options.
 * @param {string} options.serverKey - Midtrans Server Key (backend-only).
 * @param {string} [options.snapBaseUrl] - Snap base URL (default sandbox).
 * @param {string} [options.apiBaseUrl] - Core API base URL (default sandbox).
 * @param {Function} [options.fetchImpl] - Fetch implementation (default global fetch).
 * @returns {object} Midtrans client.
 */
function createMidtransClient({
  serverKey,
  snapBaseUrl = 'https://app.sandbox.midtrans.com/snap',
  apiBaseUrl = 'https://api.sandbox.midtrans.com',
  fetchImpl = fetch
} = {}) {
  if (!serverKey) throw new Error('createMidtransClient requires a serverKey');

  const authHeader = `Basic ${Buffer.from(`${serverKey}:`, 'utf8').toString('base64')}`;

  async function request(url, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch (error) {
      throw new MidtransError(`Midtrans request failed: ${error.message}`);
    }

    let data = null;
    try {
      data = await response.json();
    } catch (_error) {
      data = null;
    }

    if (!response.ok) {
      const error = new MidtransError(`Midtrans responded ${response.status} for ${method} ${url}`, response.status);
      error.body = data;
      throw error;
    }
    return data;
  }

  return {
    /**
     * Creates a Snap transaction (ADR-0008).
     *
     * @param {object} input - Snap inputs.
     * @param {string} input.orderId - {booking_id}-{attempt}.
     * @param {number} input.grossAmount - Server-side total (IDR, integer).
     * @param {object[]} input.itemDetails - Item lines (per category + fees).
     * @param {object} [input.customerDetails] - { email, first_name } for prefill.
     * @param {Date|string} input.startTime - Booking created_at (payment entry P).
     * @param {string} [input.method] - Requested payment method (wrapper page choice).
     * @param {object} [input.callbacks] - { finish, unfinish, error } redirect URLs.
     * @returns {Promise<object>} { token, redirect_url }.
     */
    async createSnap({ orderId, grossAmount, itemDetails, customerDetails, startTime, method, callbacks }) {
      const enabledPayments = method && ENABLED_PAYMENTS.includes(method) ? [method] : [...ENABLED_PAYMENTS];
      const payload = {
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
        item_details: itemDetails,
        ...(customerDetails ? { customer_details: customerDetails } : {}),
        enabled_payments: enabledPayments,
        expiry: { start_time: formatMidtransTime(startTime), unit: 'minutes', duration: 10 },
        ...(callbacks ? { callbacks } : {})
      };
      const data = await request(`${snapBaseUrl}/v1/transactions`, { method: 'POST', body: payload });
      return { token: data.token, redirectUrl: data.redirect_url };
    },

    /**
     * Gets a transaction status (Get Status API, ADR-0008 confirmation source).
     *
     * @param {string} orderId - Midtrans order_id.
     * @returns {Promise<object>} Midtrans status body.
     * @throws {MidtransError} With status 404 when the transaction does not exist.
     */
    async getStatus(orderId) {
      return request(`${apiBaseUrl}/v2/${encodeURIComponent(orderId)}/status`);
    },

    /**
     * Expires a transaction (best-effort; 412 means already expired/settled).
     *
     * @param {string} orderId - Midtrans order_id.
     * @returns {Promise<object>} Midtrans expire body.
     */
    async expire(orderId) {
      return request(`${apiBaseUrl}/v2/${encodeURIComponent(orderId)}/expire`, { method: 'POST', body: {} });
    }
  };
}

module.exports = { createMidtransClient, formatMidtransTime, MidtransError, ENABLED_PAYMENTS };
