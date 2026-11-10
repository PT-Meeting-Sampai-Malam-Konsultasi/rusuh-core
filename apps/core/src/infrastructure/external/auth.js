/**
 * Auth-module internal client (private network). core-module uses it to
 * resolve the buyer's e-mail + locale before publishing an e-mail job —
 * notification-module only accepts `to` = a real e-mail address (LLD-04 §3,
 * D17) and never calls other modules itself.
 *  GET {baseUrl}/v1/internal/accounts/{accountId}  (x-service-key)
 *    -> { id, email, locale, fullName }
 * When baseUrl is not configured the client runs in stub mode (local dev /
 * tests): getAccount returns null and the e-mail publish step is skipped.
 */

class AuthClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] - Auth-module internal base URL.
   * @param {string} [options.serviceKey] - Shared service credential header.
   * @param {number} [options.timeoutMs] - Per-call timeout (default 3000).
   * @param {Function} [options.fetchImpl] - fetch implementation (tests inject a stub).
   */
  constructor({ baseUrl, serviceKey, timeoutMs = 3000, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, '') : null;
    this.serviceKey = serviceKey || null;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  get isStub() {
    return !this.baseUrl;
  }

  async _call(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          ...(this.serviceKey ? { 'x-service-key': this.serviceKey } : {})
        },
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`Auth-module responded ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Gets the e-mail projection of one account.
   *
   * @param {string} accountId - Account id (booking.accountId, token sub).
   * @returns {Promise<{id: string, email: string, locale: string, fullName: string|null}|null>}
   *   Null in stub mode or when the account does not exist (404).
   */
  async getAccount(accountId) {
    if (this.isStub) return null;
    try {
      return await this._call(`/v1/internal/accounts/${encodeURIComponent(accountId)}`);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
}

module.exports = { AuthClient };
