const { verifyAccountToken } = require('@rusuh/auth');
const { apiError } = require('@/domain/errors');

/**
 * Production auth providers for the officer module.
 *
 * - Account JWTs are verified LOCALLY with @rusuh/auth (Ed25519, Q43); the
 *   public keys come from AUTH_PUBLIC_KEYS_JSON ({ kid: JWK }) — published by
 *   auth-module. No hot-path call to auth-module.
 * - The jti denylist (Valkey, Q42 logout revocation) is consulted when a
 *   denylist is provided, so a logged-out account cannot scan at the gate.
 *   Fail-closed: when the denylist is unreachable the request fails with 503
 *   instead of accepting a possibly-revoked token (same rule as auth-module,
 *   LLD-01 §6.3).
 * - The officer ROLE is resolved server-side from accounts.role (LLD-05 §2),
 *   never from JWT claims (Q42: claims are sub/iat/exp/jti/kid only).
 */

/**
 * Builds the default token verifier from config.
 *
 * @param {object} config - Service config (authPublicKeys: Map kid -> JWK).
 * @param {object} [denylist] - jti denylist ({ isDenied }); omitted in dev
 *   mode (no VALKEY_URL) — verification then covers signature + expiry +
 *   audience/issuer only.
 * @returns {Function} Async (token) => payload; throws 401 UNAUTHORIZED /
 *   503 SERVICE_UNAVAILABLE.
 */
function createDefaultVerifyToken(config, denylist) {
  return async (token) => {
    if (!config.authPublicKeys || config.authPublicKeys.size === 0) {
      throw apiError('UNAUTHORIZED', 'Account token verification is not configured');
    }
    try {
      return await verifyAccountToken(token, {
        publicKeys: config.authPublicKeys,
        expectedAud: config.authAudience,
        expectedIss: config.authIssuer,
        ...(denylist ? { isDenied: (jti) => denylist.isDenied(jti) } : {})
      });
    } catch (error) {
      if (error && error.code === 'DENYLIST_UNAVAILABLE') {
        throw apiError('SERVICE_UNAVAILABLE', 'Token verification is unavailable, try again');
      }
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
