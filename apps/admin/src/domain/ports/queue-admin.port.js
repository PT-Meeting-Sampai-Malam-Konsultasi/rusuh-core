/**
 * Queue-admin port — the contract for the queue-module admin API client
 * (J8 A / item 13). Implemented by infrastructure/external/queue-admin.js,
 * which forwards the call to the queue-module admin API (private port)
 * with the operator token from config. The queue owns the `paused`
 * state; this client only forwards. A pause is equivalent to cap=0
 * (no new admission). Use cases receive an object implementing this
 * port; they never require() an infrastructure file.
 *
 * @typedef {object} QueueAdminClient
 * @property {(eventId: string, body: object) => Promise<object>} updateQueue - PATCH /admin/events/:eventId/queue on the queue-module admin API; resolves the frontier object, throws with code QUEUE_ADMIN_UNAVAILABLE (503) when the API is unreachable or unconfigured.
 */

module.exports = {};
