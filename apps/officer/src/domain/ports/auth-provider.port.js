/**
 * Auth-provider port — the adapter interface the officer endpoints depend on.
 *
 * The application/presentation layers depend only on this contract
 * (dependency inversion); the adapters in infrastructure/auth-provider.js
 * implement it. No runtime code lives here: the typedefs below ARE the
 * contract.
 *
 * - Account JWTs are verified LOCALLY with @rusuh/auth (Ed25519, Q43);
 *   the public keys come from AUTH_PUBLIC_KEYS_JSON ({ kid: JWK }).
 * - The officer ROLE is resolved server-side from accounts.role (LLD-05 §2),
 *   never from JWT claims (Q42: claims are sub/iat/exp/jti/kid only).
 *
 * GAP (kept as-is from the pre-refactor code): the jti denylist (Valkey,
 * Q42 logout revocation) is NOT wired — there is no Valkey client in this
 * module. Until it is wired, verification covers signature + expiry +
 * audience/issuer only.
 *
 * @typedef {object} AccountTokenPayload
 * @property {string} sub - Account id.
 * @property {string} [jti] - Token id.
 * @property {number} [exp] - Expiry (seconds since epoch).
 *
 * @typedef {Function} VerifyToken
 * @param {string} token - Account JWT (Bearer).
 * @returns {Promise<AccountTokenPayload>} Payload; throws 401 UNAUTHORIZED.
 *
 * @typedef {Function} RoleResolver
 * @param {string} accountId - Account id.
 * @returns {Promise<string|null>} Role string ('officer' | 'customer' | …) or null.
 */
