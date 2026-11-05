const { apiError } = require('@/lib/api-error');
const { issueSession } = require('@/lib/issue-session');

/**
 * Session service (LLD-01 §6.2–§6.4, openapi.yaml refreshSession/logout).
 * Refresh: opaque token, hash-stored, rotation + reuse detection (reuse
 * revokes the whole family). Logout: revoke the refresh family + denylist
 * the access jti (TTL = remaining token life).
 *
 * @param {object} deps - { store, denylist, tokens, logger }.
 * @returns {object} { refresh, logout }.
 */
function createSessionService({ store, denylist, tokens, logger }) {
  const log = logger || { info: () => {}, error: () => {} };

  return {
    /**
     * Rotates a refresh token. Reads the token from the body (mobile) or
     * the `__Host-rt` cookie (web). Returns a new Session.
     */
    async refresh({ refreshToken, deviceId }) {
      if (!refreshToken) throw apiError('UNAUTHORIZED', 'Refresh token tidak ditemukan');
      const tokenHash = tokens.hashRefreshToken(refreshToken);
      const row = await store.findRefreshTokenByHash(tokenHash);
      if (!row) throw apiError('UNAUTHORIZED', 'Refresh token tidak valid');

      const at = new Date();
      if (row.revokedAt) {
        // A revoked token presented again: reuse signal. Revoke the whole
        // family (if still alive) + denylist the current access jti + alert.
        if (row.revokedReason === 'rotated') {
          await store.revokeRefreshFamily(row.familyId, 'reuse');
          if (row.currentAccessJti) {
            const record = await store.findAccessTokenRecord(row.currentAccessJti);
            const ttl = record ? Math.max(1, Math.floor((record.expiresAt - at) / 1000)) : 900;
            await denylist.deny(row.currentAccessJti, ttl);
          }
          log.error('refresh_reuse_detected');
        }
        throw apiError('UNAUTHORIZED', 'Refresh token tidak valid');
      }
      if (row.expiresAt <= at) throw apiError('UNAUTHORIZED', 'Refresh token sudah kedaluwarsa');

      const resolvedAccount = await store.findAccountById(row.accountId);
      if (!resolvedAccount) throw apiError('UNAUTHORIZED', 'Akun tidak ditemukan');
      const profile = await store.findProfile(resolvedAccount.id);

      // Rotate: revoke the old token, issue a new one in the same family
      // (the family expiry is NOT extended, LLD-01 §3.4).
      await store.updateRefreshToken(row.id, { revokedAt: at, revokedReason: 'rotated', lastUsedAt: at });
      log.info('token_refreshed');
      return issueSession({
        store,
        tokens,
        account: resolvedAccount,
        profile,
        deviceLabel: deviceId ? `device:${deviceId}` : row.deviceLabel,
        familyId: row.familyId,
        familyExpiresAt: row.expiresAt,
        isNewAccount: false
      });
    },

    /**
     * Logs out this device: revokes the refresh family + denylists the
     * access jti (TTL = remaining token life). The family is resolved from
     * the access jti (via the access-token record) or from the refresh
     * token when provided.
     */
    async logout({ accessJti, accessExp, refreshToken }) {
      const at = new Date();
      let familyId = null;

      if (accessJti) {
        const record = await store.findAccessTokenRecord(accessJti);
        if (record) familyId = record.familyId;
        const ttl = accessExp ? Math.max(1, accessExp - Math.floor(at.getTime() / 1000)) : 900;
        await denylist.deny(accessJti, ttl);
      }
      if (refreshToken) {
        const row = await store.findRefreshTokenByHash(tokens.hashRefreshToken(refreshToken));
        if (row) familyId = row.familyId;
      }
      if (familyId) {
        await store.revokeRefreshFamily(familyId, 'logout');
      }

      log.info('logout');
    }
  };
}

module.exports = { createSessionService };
