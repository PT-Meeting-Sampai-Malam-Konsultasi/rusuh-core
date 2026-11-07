const { ApiError } = require('@/errors');

/**
 * Queue-admin service (J8 A / item 13, 6 Nov). The backoffice calls the
 * queue-module admin API (private port) to pause/resume/close a queue;
 * the queue owns the `paused` state. This service validates the request,
 * forwards it through the injected queue client, and audits the change.
 * A pause is equivalent to cap=0 (no new admission, item 13).
 *
 * @param {object} store - Store (event lookup + audit).
 * @param {object} audit - Audit service.
 * @param {object} queueClient - Queue admin API client.
 * @returns {object} Queue operations.
 */
function createQueueService(store, audit, queueClient) {
  return {
    async updateQueue(eventId, body, actor) {
      const event = await store.getEvent(eventId);
      if (!event) throw new ApiError('NOT_FOUND', `Event ${eventId} not found`);
      let frontier;
      try {
        frontier = await queueClient.updateQueue(eventId, body);
      } catch (error) {
        if (error.code === 'QUEUE_ADMIN_UNAVAILABLE' || error.status === 503) {
          throw new ApiError('SERVICE_UNAVAILABLE', 'Queue admin API is unavailable');
        }
        throw error;
      }
      await audit.record({
        actor,
        action: 'QUEUE_STATE_CHANGED',
        eventId,
        details: { state: body.state, reason: body.reason || null }
      });
      return frontier;
    }
  };
}

module.exports = { createQueueService };
