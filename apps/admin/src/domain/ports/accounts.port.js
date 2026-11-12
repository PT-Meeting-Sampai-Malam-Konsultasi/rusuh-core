/**
 * Accounts port: the role lookup the admin guard needs. Implemented by
 * infrastructure/external/auth-accounts.js (auth-module internal API). The
 * role is owned by auth and is never read from the JWT (Q42 claim discipline).
 *
 * @typedef {object} AccountProjection
 * @property {string} id - Account id (token sub).
 * @property {string} email - Account e-mail.
 * @property {string} role - user | officer | admin.
 *
 * @typedef {object} AccountsPort
 * @property {(accountId: string) => Promise<AccountProjection|null>} getAccount - Null when the
 *   account does not exist; throws SERVICE_UNAVAILABLE when auth cannot be reached (fail-closed).
 */

module.exports = {};
