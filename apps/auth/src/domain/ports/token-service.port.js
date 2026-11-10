/**
 * TokenService port — the JWT + opaque-refresh-token contract the use
 * cases depend on. Implemented by infrastructure/tokens/token-service
 * (Ed25519 account JWT via @rusuh/auth, Q43; opaque refresh, Q44).
 *
 * @typedef {object} TokenService
 * @property {function(string, string): {token: string, jti: string, exp: number, familyId: string}} signAccessToken - Signs an access JWT (15 min).
 * @property {function(string, function(string): Promise<boolean>): Promise<object>} verifyAccessToken - Verifies an access JWT (+ denylist check).
 * @property {function(): {token: string, tokenHash: string}} createRefreshToken - Generates an opaque refresh token.
 * @property {function(string): string} hashRefreshToken - SHA-256 hex of a refresh token.
 * @property {function(Date): Date} refreshFamilyExpiresAt - Family expiry (7 days from a date).
 */

module.exports = {};
