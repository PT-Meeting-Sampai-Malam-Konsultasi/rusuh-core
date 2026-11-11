const express = require('express');

/**
 * Creates the JWKS router (public, well-known path).
 *
 * @param {object} controller - JWKS controllers.
 * @returns {import('express').Router} Express router.
 */
function createJwksRouter(controller) {
  const router = express.Router();
  router.get('/.well-known/jwks.json', controller.getJwks);
  return router;
}

module.exports = { createJwksRouter };
