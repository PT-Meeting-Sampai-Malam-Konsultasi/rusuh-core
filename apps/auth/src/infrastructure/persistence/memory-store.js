const crypto = require('crypto');

/**
 * In-memory store implementing the auth repository interface (LLD-01 §3).
 * Used for tests and for running without Postgres (DATABASE_URL unset).
 * All methods are async to match the Postgres store.
 */
function createMemoryStore() {
  const accounts = new Map(); // id -> account
  const accountsByEmail = new Map(); // email -> id
  const profiles = new Map(); // accountId -> profile
  const otpChallenges = new Map(); // challengeId -> challenge
  const refreshTokens = new Map(); // id -> row
  const refreshTokensByHash = new Map(); // tokenHash -> id
  const accessTokens = new Map(); // jti -> record
  const auditLog = [];

  const now = () => new Date();

  return {
    // -- accounts ---------------------------------------------------------
    async findAccountByEmail(email) {
      const id = accountsByEmail.get(email);
      return id ? { ...accounts.get(id) } : null;
    },

    async findAccountById(id) {
      const account = accounts.get(id);
      return account ? { ...account } : null;
    },

    async createAccount({ email }) {
      const account = {
        id: `acc_${crypto.randomUUID()}`,
        email,
        profileComplete: false,
        createdAt: now(),
        updatedAt: now()
      };
      accounts.set(account.id, account);
      accountsByEmail.set(email, account.id);
      return { ...account };
    },

    // -- profiles ---------------------------------------------------------
    async findProfile(accountId) {
      const profile = profiles.get(accountId);
      return profile ? { ...profile } : null;
    },

    async upsertProfile(accountId, { name, locale }) {
      const existing = profiles.get(accountId);
      const profile = {
        accountId,
        name: name ?? existing?.name ?? null,
        locale: locale ?? existing?.locale ?? 'id',
        createdAt: existing?.createdAt || now(),
        updatedAt: now()
      };
      profiles.set(accountId, profile);
      if (name !== undefined && name !== null) {
        const account = accounts.get(accountId);
        if (account) {
          account.profileComplete = true;
          account.updatedAt = now();
        }
      }
      return { ...profile };
    },

    // -- OTP challenges ---------------------------------------------------
    async createOtpChallenge({ email, codeHash, deviceId, locale, expiresAt }) {
      const challenge = {
        id: `ch_${crypto.randomBytes(12).toString('base64url')}`,
        email,
        codeHash,
        deviceId: deviceId || null,
        locale: locale || 'id',
        purpose: null,
        expiresAt,
        attempts: 0,
        usedAt: null,
        createdAt: now()
      };
      otpChallenges.set(challenge.id, challenge);
      return { ...challenge };
    },

    async findOtpChallengeById(challengeId) {
      const challenge = otpChallenges.get(challengeId);
      return challenge ? { ...challenge } : null;
    },

    async findLatestOtpChallengeByEmail(email) {
      let latest = null;
      otpChallenges.forEach((challenge) => {
        if (challenge.email !== email) return;
        if (!latest || challenge.createdAt > latest.createdAt) latest = challenge;
      });
      return latest ? { ...latest } : null;
    },

    async countOtpChallengesSince(email, since) {
      let count = 0;
      otpChallenges.forEach((challenge) => {
        if (challenge.email === email && challenge.createdAt >= since) count += 1;
      });
      return count;
    },

    async expireOtpChallengesForEmail(email, exceptId) {
      const at = now();
      otpChallenges.forEach((challenge) => {
        if (challenge.email === email && challenge.id !== exceptId && !challenge.usedAt && challenge.expiresAt > at) {
          challenge.expiresAt = at;
        }
      });
    },

    async updateOtpChallenge(id, patch) {
      const challenge = otpChallenges.get(id);
      if (!challenge) return null;
      Object.assign(challenge, patch);
      return { ...challenge };
    },

    async deleteOtpChallenge(id) {
      otpChallenges.delete(id);
    },

    // -- refresh tokens ---------------------------------------------------
    async createRefreshToken({ accountId, familyId, tokenHash, expiresAt, deviceLabel, currentAccessJti }) {
      const row = {
        id: crypto.randomUUID(),
        accountId,
        familyId,
        tokenHash,
        expiresAt,
        revokedAt: null,
        revokedReason: null,
        deviceLabel: deviceLabel || null,
        currentAccessJti: currentAccessJti || null,
        createdAt: now(),
        lastUsedAt: now()
      };
      refreshTokens.set(row.id, row);
      refreshTokensByHash.set(tokenHash, row.id);
      return { ...row };
    },

    async findRefreshTokenByHash(tokenHash) {
      const id = refreshTokensByHash.get(tokenHash);
      return id ? { ...refreshTokens.get(id) } : null;
    },

    async updateRefreshToken(id, patch) {
      const row = refreshTokens.get(id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },

    async revokeRefreshFamily(familyId, reason) {
      const at = now();
      refreshTokens.forEach((row) => {
        if (row.familyId === familyId && !row.revokedAt) {
          row.revokedAt = at;
          row.revokedReason = reason;
        }
      });
    },

    // -- access token records (jti -> family, for logout) ------------------
    async createAccessTokenRecord({ jti, accountId, familyId, expiresAt }) {
      accessTokens.set(jti, { jti, accountId, familyId, expiresAt });
    },

    async findAccessTokenRecord(jti) {
      const record = accessTokens.get(jti);
      return record ? { ...record } : null;
    },

    // -- audit ------------------------------------------------------------
    async createAuditLog({ accountId, action, detail }) {
      auditLog.push({ accountId, action, detail, createdAt: now() });
    },

    async close() {
      // nothing to close for the in-memory store
    },

    // test helpers (not part of the repository interface)
    _auditLog: auditLog,
    _otpChallenges: otpChallenges,
    _refreshTokens: refreshTokens
  };
}

module.exports = { createMemoryStore };
