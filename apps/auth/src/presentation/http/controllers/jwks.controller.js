/**
 * JWKS publication controller. Serves the account-token public keys so
 * sibling services (rusuh-queue via CORE_JWKS_URL, any future remote-JWKS
 * consumer) can verify locally without a shared secret. Public endpoint:
 * the JWK is public by construction (no "d" ever leaves this service).
 *
 * @param {object} tokens - Token service (publicJwks).
 * @returns {object} Controllers.
 */
function createJwksController(tokens) {
  return {
    getJwks: (request, response) => {
      response.locals.skipResponseEnvelope = true;
      // Consumers refresh on their own schedule (rusuh-queue caches 5 min);
      // allow intermediary caching for the same window.
      response.set('Cache-Control', 'public, max-age=300');
      response.status(200).json(tokens.publicJwks());
    }
  };
}

module.exports = { createJwksController };
