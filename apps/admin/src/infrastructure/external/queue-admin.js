/**
 * Queue admin API client (J8 A / item 13, 6 Nov). The backoffice calls the
 * queue-module admin API (private port) to pause/resume/close a queue.
 * The queue owns the `paused` state; this client only forwards the call
 * with the operator token (SSO, aud rusuh-queue-admin) from config.
 *
 * @param {object} options - Client configuration.
 * @param {string} [options.baseUrl] - Queue admin base URL (e.g. https://admin.internal.rusuh.id/v1).
 * @param {string} [options.operatorToken] - Operator token for the queue admin API.
 * @param {Function} [options.fetchImpl] - Fetch implementation (tests).
 * @returns {object} { updateQueue(eventId, body) }.
 */
function createQueueClient({ baseUrl, operatorToken, fetchImpl = fetch } = {}) {
  return {
    async updateQueue(eventId, body) {
      if (!baseUrl) {
        const error = new Error('Queue admin API is not configured (QUEUE_ADMIN_URL)');
        error.code = 'QUEUE_ADMIN_UNAVAILABLE';
        error.status = 503;
        throw error;
      }
      const response = await fetchImpl(`${baseUrl}/admin/events/${encodeURIComponent(eventId)}/queue`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(operatorToken ? { Authorization: `Bearer ${operatorToken}` } : {})
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const error = new Error(`Queue admin API returned ${response.status}`);
        error.code = 'QUEUE_ADMIN_UNAVAILABLE';
        error.status = 503;
        throw error;
      }
      return response.json();
    }
  };
}

module.exports = { createQueueClient };
