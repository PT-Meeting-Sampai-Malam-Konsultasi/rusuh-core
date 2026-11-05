const crypto = require('crypto');

/**
 * Issues a Session (openapi.yaml Session schema): a new access JWT + a new
 * opaque refresh token in the given family, and records the access jti ->
 * family mapping (used by logout to revoke the family).
 *
 * @param {object} options - Issue inputs.
 * @param {object} options.store - Repository.
 * @param {object} options.tokens - Token service.
 * @param {object} options.account - Account { id, email, profileComplete }.
 * @param {object} [options.profile] - Profile { name, locale }.
 * @param {string} [options.deviceLabel] - Device label for the refresh row.
 * @param {string} [options.familyId] - Existing family (rotation) or new.
 * @param {Date} [options.familyExpiresAt] - Family expiry (rotation keeps it).
 * @param {boolean} [options.isNewAccount] - Whether the account was just created.
 * @returns {Promise<object>} Session { accessToken, expiresIn, refreshToken, isNewAccount, user }.
 */
async function issueSession({
  store,
  tokens,
  account,
  profile,
  deviceLabel,
  familyId,
  familyExpiresAt,
  isNewAccount = false
}) {
  const family = familyId || crypto.randomUUID();
  const expiresAt = familyExpiresAt || tokens.refreshFamilyExpiresAt();
  const { token: refreshToken, tokenHash } = tokens.createRefreshToken();
  const { token: accessToken, jti, exp } = tokens.signAccessToken(account.id, family);

  await store.createRefreshToken({
    accountId: account.id,
    familyId: family,
    tokenHash,
    expiresAt,
    deviceLabel,
    currentAccessJti: jti
  });
  await store.createAccessTokenRecord({
    jti,
    accountId: account.id,
    familyId: family,
    expiresAt: new Date(exp * 1000)
  });

  return {
    accessToken,
    expiresIn: 900,
    refreshToken,
    isNewAccount,
    user: {
      userId: account.id,
      email: account.email,
      fullName: profile?.name ?? null,
      locale: profile?.locale ?? 'id'
    }
  };
}

module.exports = { issueSession };
