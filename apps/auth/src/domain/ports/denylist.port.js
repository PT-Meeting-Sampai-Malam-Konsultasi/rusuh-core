/**
 * Denylist port — the revoked-access-jti contract the session use case
 * and the Bearer middleware depend on. Implemented by
 * infrastructure/cache (Valkey or in-memory, Q42). Fail-closed: a
 * cache error throws DENYLIST_UNAVAILABLE so the caller can reject
 * with 503 (LLD-01 §6.3).
 *
 * @typedef {object} Denylist
 * @property {function(string): Promise<boolean>} isDenied - Whether a jti is denylisted.
 * @property {function(string, number): Promise<void>} deny - Denylists a jti for ttlSeconds.
 * @property {function(): Promise<void>} close - Releases the denylist (client disconnect / no-op).
 */

module.exports = {};
