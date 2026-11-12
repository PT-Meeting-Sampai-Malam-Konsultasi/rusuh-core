const { ApiError } = require('@/domain/errors');

/**
 * Auth-module client for the minimum account projection needed by the admin
 * guard. Role remains owned by auth; it is never trusted from the JWT.
 *
 * @param {object} options - Auth-service connection options.
 * @param {string} [options.baseUrl] - Auth internal base URL.
 * @param {string} [options.serviceKey] - Shared internal-service credential.
 * @param {number} [options.timeoutMs] - Request deadline in milliseconds.
 * @param {Function} [options.fetchImpl] - Fetch implementation for tests.
 * @returns {object} Account lookup client.
 */
function createAuthAccountsClient({ baseUrl, serviceKey, timeoutMs = 3000, fetchImpl = fetch } = {}) {
  const normalizedBaseUrl = baseUrl ? baseUrl.replace(/\/$/, '') : null;

  return {
    async getAccount(accountId) {
      if (!normalizedBaseUrl) throw new ApiError('SERVICE_UNAVAILABLE', 'Auth account lookup is not configured');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${normalizedBaseUrl}/v1/internal/accounts/${encodeURIComponent(accountId)}`, {
          headers: { 'x-service-key': serviceKey || '' },
          signal: controller.signal
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new ApiError('SERVICE_UNAVAILABLE', 'Auth account lookup is unavailable');
        return response.json();
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('SERVICE_UNAVAILABLE', 'Auth account lookup is unavailable');
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

module.exports = { createAuthAccountsClient };
