const express = require('express');
const { wrapController } = require('@/presentation/http/middleware/async-handler');

/**
 * Creates the queue-admin router (J8 A / item 13). Admin-only.
 * The endpoint proxies to the queue-module admin API (private port).
 *
 * @param {object} controller - Queue endpoint controllers.
 * @returns {import('express').Router} Express queue-admin router.
 */
function createQueueRouter(controller) {
  const c = wrapController(controller);
  const router = express.Router();
  router.patch('/events/:eventId/queue', c.updateQueue);
  return router;
}

module.exports = { createQueueRouter };
