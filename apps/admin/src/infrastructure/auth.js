const { verifyAccountToken } = require('@rusuh/auth');

/**
 * Builds the account-JWT verifier for the admin module (Q43, ADR-0017).
 * Public keys come from a JWKS JSON string (AUTH_PUBLIC_KEY_JWK, a single
 * JWK or {keys: [...]}) or a JWKS URL (AUTH_JWKS_URL, fetched + cached).
 * Fail-closed: with no keys configured every token is rejected.
 *
 * @param {object} options - Verifier configuration.
 * @param {string} [options.jwksJson] - JWKS JSON string.
 * @param {string} [options.jwksUrl] - JWKS URL.
 * @param {string} [options.expectedAud] - Expected audience.
 * @param {string} [options.expectedIss] - Expected issuer.
 * @param {Function} [options.fetchImpl] - Fetch implementation (tests).
 * @returns {object} { verify(token) } — resolves the payload or throws UNAUTHORIZED.
 */
function createVerifier({ jwksJson, jwksUrl, expectedAud, expectedIss, fetchImpl = fetch } = {}) {
  let keysPromise = null;

  async function loadKeys() {
    if (keysPromise) return keysPromise;
    keysPromise = (async () => {
      if (jwksJson) {
        const parsed = JSON.parse(jwksJson);
        const keys = Array.isArray(parsed.keys) ? parsed.keys : [parsed];
        return new Map(keys.filter((key) => key && key.kid).map((key) => [key.kid, key]));
      }
      if (jwksUrl) {
        const response = await fetchImpl(jwksUrl);
        if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
        const parsed = await response.json();
        const keys = Array.isArray(parsed.keys) ? parsed.keys : [parsed];
        return new Map(keys.filter((key) => key && key.kid).map((key) => [key.kid, key]));
      }
      return new Map();
    })();
    return keysPromise;
  }

  async function verify(token) {
    const publicKeys = await loadKeys();
    return verifyAccountToken(token, { publicKeys, expectedAud, expectedIss });
  }

  return { verify, loadKeys };
}

module.exports = { createVerifier };
