const { verifyAccountToken } = require('@rusuh/auth');
const { apiError } = require('@/domain/errors');

/**
 * Production auth providers for the officer module.
 *
 * - Account JWTs are verified LOCALLY with @rusuh/auth (Ed25519, Q43); the
 *   public keys come from AUTH_PUBLIC_KEYS_JSON ({ kid: JWK }) — published by
 *   auth-module. No hot-path call to auth-module.
 * - The officer ROLE is resolved server-side from accounts.role (LLD-05 §2),
 *   never from JWT claims (Q42: claims are sub/iat/exp/jti/kid only).
 *
 * GAP (noted in README): the jti denylist (Valkey, Q42 logout revocation) is
 * not wired here yet — there is no Valkey client in this module. Until it is
 * wired, verification covers signature + expiry + audience/issuer only. The
 * auth-module story branch owns the JWKS/denylist publication; this module
 * consumes them via config.
 */

/**
 * Builds the default token verifier from config.
 *
 * @param {object} config - Service config (authPublicKeys: Map kid -> JWK).
 * @returns {Function} Async (token) => payload; throws 401 UNAUTHORIZED.
 */
function createDefaultVerifyToken(config) {
  return async (token) => {
    if (!config.authPublicKeys || config.authPublicKeys.size === 0) {
      throw apiError('UNAUTHORIZED', 'Account token verification is not configured');
    }
    try {
      return await verifyAccountToken(token, {
        publicKeys: config.authPublicKeys,
        expectedAud: config.authAudience,
        expectedIss: config.authIssuer
        // isDenied: Valkey denylist lookup — TODO when the Valkey client lands.
      });
    } catch (error) {
      if (error && error.code === 'UNAUTHORIZED') throw apiError('UNAUTHORIZED', error.message);
      throw error;
    }
  };
}

/**
 * Builds the default role resolver (Postgres accounts table).
 *
 * @param {object} pool - pg Pool.
 * @returns {Function} Async (accountId) => role string or null.
 */
function createPostgresRoleResolver(pool) {
  return async (accountId) => {
    const { rows } = await pool.query('SELECT role FROM accounts WHERE id = $1', [accountId]);
    return rows.length === 0 ? null : rows[0].role;
  };
}

module.exports = { createDefaultVerifyToken, createPostgresRoleResolver };
