/**
 * AuthStore port — the repository contract the use cases depend on.
 * Implemented by infrastructure/persistence (Postgres or in-memory).
 * Every method is async to match the Postgres implementation.
 *
 * @typedef {object} AuthStore
 * @property {function(string): Promise<object|null>} findAccountByEmail - Account by email, or null.
 * @property {function(string): Promise<object|null>} findAccountById - Account by id, or null.
 * @property {function({email: string}): Promise<object>} createAccount - Creates an account.
 * @property {function(string): Promise<object|null>} findProfile - Profile by account id, or null.
 * @property {function(string, {name: string, locale: string}): Promise<object>} upsertProfile - Creates/updates a profile.
 * @property {function({email: string, codeHash: string, deviceId: string|null, fullName: string|null, locale: string, expiresAt: Date}): Promise<object>} createOtpChallenge - Creates an OTP challenge.
 * @property {function(string): Promise<object|null>} findOtpChallengeById - Challenge by id, or null.
 * @property {function(string): Promise<object|null>} findLatestOtpChallengeByEmail - Latest challenge for an email, or null.
 * @property {function(string, Date): Promise<number>} countOtpChallengesSince - Challenges for an email since a time.
 * @property {function(string, string): Promise<void>} expireOtpChallengesForEmail - Expires an email's challenges except one.
 * @property {function(string, object): Promise<object|null>} updateOtpChallenge - Patches a challenge, or null.
 * @property {function(string): Promise<void>} deleteOtpChallenge - Deletes a challenge.
 * @property {function({accountId: string, familyId: string, tokenHash: string, expiresAt: Date, deviceLabel: string|null, currentAccessJti: string|null}): Promise<object>} createRefreshToken - Creates a refresh-token row.
 * @property {function(string): Promise<object|null>} findRefreshTokenByHash - Refresh row by token hash, or null.
 * @property {function(string, object): Promise<object|null>} updateRefreshToken - Patches a refresh row, or null.
 * @property {function(string, string): Promise<void>} revokeRefreshFamily - Revokes all live tokens of a family.
 * @property {function({jti: string, accountId: string, familyId: string, expiresAt: Date}): Promise<void>} createAccessTokenRecord - Records an access jti -> family mapping.
 * @property {function(string): Promise<object|null>} findAccessTokenRecord - Access record by jti, or null.
 * @property {function({accountId: string, action: string, detail: object}): Promise<void>} createAuditLog - Appends an audit entry.
 * @property {function(): Promise<void>} close - Releases the store (pool close / no-op).
 */

module.exports = {};
