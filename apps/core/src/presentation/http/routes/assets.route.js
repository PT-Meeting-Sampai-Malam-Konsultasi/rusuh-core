const express = require('express');

/**
 * Creates public browser-facing asset routes.
 *
 * @param {object} controller - Asset endpoint controllers.
 * @returns {import('express').Router} Express assets router.
 */
function createAssetsRouter(controller) {
  const router = express.Router();
  router.get('/v1/core/assets/events/:eventId/hero', controller.getEventHero);
  return router;
}

module.exports = { createAssetsRouter };
