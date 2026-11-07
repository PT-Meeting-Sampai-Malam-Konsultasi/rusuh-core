const { Pool } = require('pg');

/**
 * Postgres store implementing the auth repository interface (LLD-01 §3).
 * Schema: db/migrations/001_auth.sql. All methods return camelCase objects.
 *
 * @param {object} config - { databaseUrl }.
 * @returns {object} Store.
 */
function createPostgresStore({ databaseUrl }) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });

  const mapAccount = (row) => ({
    id: row.id,
    email: row.email,
    profileComplete: row.profile_complete,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const mapProfile = (row) => ({
    accountId: row.account_id,
    name: row.name,
    locale: row.locale,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const mapChallenge = (row) => ({
    id: row.id,
    email: row.email,
    codeHash: row.code_hash,
    deviceId: row.device_id,
    fullName: row.full_name,
    locale: row.locale,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    usedAt: row.used_at,
    createdAt: row.created_at
  });

  const mapRefresh = (row) => ({
    id: row.id,
    accountId: row.account_id,
    familyId: row.family_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    deviceLabel: row.device_label,
    currentAccessJti: row.current_access_jti,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  });

  return {
    async findAccountByEmail(email) {
      const { rows } = await pool.query('SELECT * FROM accounts WHERE email = $1', [email]);
      return rows[0] ? mapAccount(rows[0]) : null;
    },

    async findAccountById(id) {
      const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [id]);
      return rows[0] ? mapAccount(rows[0]) : null;
    },

    async createAccount({ email }) {
      const { rows } = await pool.query(
        'INSERT INTO accounts (email, profile_complete) VALUES ($1, false) RETURNING *',
        [email]
      );
      return mapAccount(rows[0]);
    },

    async findProfile(accountId) {
      const { rows } = await pool.query('SELECT * FROM profiles WHERE account_id = $1', [accountId]);
      return rows[0] ? mapProfile(rows[0]) : null;
    },

    async upsertProfile(accountId, { name, locale }) {
      const { rows } = await pool.query(
        `INSERT INTO profiles (account_id, name, locale)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE
           SET name = COALESCE(EXCLUDED.name, profiles.name),
               locale = COALESCE(EXCLUDED.locale, profiles.locale),
               updated_at = now()
         RETURNING *`,
        [accountId, name ?? null, locale ?? null]
      );
      if (name !== undefined && name !== null) {
        await pool.query('UPDATE accounts SET profile_complete = true, updated_at = now() WHERE id = $1', [accountId]);
      }
      return mapProfile(rows[0]);
    },

    async createOtpChallenge({ email, codeHash, deviceId, fullName, locale, expiresAt }) {
      const { rows } = await pool.query(
        `INSERT INTO otp_codes (email, code_hash, device_id, full_name, locale, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [email, codeHash, deviceId || null, fullName || null, locale || 'id', expiresAt]
      );
      return mapChallenge(rows[0]);
    },

    async findOtpChallengeById(challengeId) {
      const { rows } = await pool.query('SELECT * FROM otp_codes WHERE id = $1', [challengeId]);
      return rows[0] ? mapChallenge(rows[0]) : null;
    },

    async findLatestOtpChallengeByEmail(email) {
      const { rows } = await pool.query('SELECT * FROM otp_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [
        email
      ]);
      return rows[0] ? mapChallenge(rows[0]) : null;
    },

    async countOtpChallengesSince(email, since) {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM otp_codes WHERE email = $1 AND created_at >= $2',
        [email, since]
      );
      return rows[0].count;
    },

    async expireOtpChallengesForEmail(email, exceptId) {
      await pool.query(
        `UPDATE otp_codes SET expires_at = now()
         WHERE email = $1 AND id <> $2 AND used_at IS NULL AND expires_at > now()`,
        [email, exceptId]
      );
    },

    async updateOtpChallenge(id, patch) {
      const sets = [];
      const values = [id];
      const columns = { attempts: 'attempts', usedAt: 'used_at', purpose: 'purpose', expiresAt: 'expires_at' };
      Object.entries(patch).forEach(([key, value]) => {
        if (!columns[key]) return;
        values.push(value);
        sets.push(`${columns[key]} = $${values.length}`);
      });
      if (sets.length === 0) return this.findOtpChallengeById(id);
      const { rows } = await pool.query(`UPDATE otp_codes SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
      return rows[0] ? mapChallenge(rows[0]) : null;
    },

    async deleteOtpChallenge(id) {
      await pool.query('DELETE FROM otp_codes WHERE id = $1', [id]);
    },

    async createRefreshToken({ accountId, familyId, tokenHash, expiresAt, deviceLabel, currentAccessJti }) {
      const { rows } = await pool.query(
        `INSERT INTO refresh_tokens (account_id, family_id, token_hash, expires_at, device_label, current_access_jti)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [accountId, familyId, tokenHash, expiresAt, deviceLabel || null, currentAccessJti || null]
      );
      return mapRefresh(rows[0]);
    },

    async findRefreshTokenByHash(tokenHash) {
      const { rows } = await pool.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
      return rows[0] ? mapRefresh(rows[0]) : null;
    },

    async updateRefreshToken(id, patch) {
      const sets = [];
      const values = [id];
      const columns = {
        revokedAt: 'revoked_at',
        revokedReason: 'revoked_reason',
        currentAccessJti: 'current_access_jti',
        lastUsedAt: 'last_used_at'
      };
      Object.entries(patch).forEach(([key, value]) => {
        if (!columns[key]) return;
        values.push(value);
        sets.push(`${columns[key]} = $${values.length}`);
      });
      if (sets.length === 0) return null;
      const { rows } = await pool.query(
        `UPDATE refresh_tokens SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        values
      );
      return rows[0] ? mapRefresh(rows[0]) : null;
    },

    async revokeRefreshFamily(familyId, reason) {
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId, reason]
      );
    },

    async createAccessTokenRecord({ jti, accountId, familyId, expiresAt }) {
      await pool.query(
        `INSERT INTO access_tokens (jti, account_id, family_id, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (jti) DO NOTHING`,
        [jti, accountId, familyId, expiresAt]
      );
    },

    async findAccessTokenRecord(jti) {
      const { rows } = await pool.query('SELECT * FROM access_tokens WHERE jti = $1', [jti]);
      if (!rows[0]) return null;
      return {
        jti: rows[0].jti,
        accountId: rows[0].account_id,
        familyId: rows[0].family_id,
        expiresAt: rows[0].expires_at
      };
    },

    async createAuditLog({ accountId, action, detail }) {
      await pool.query('INSERT INTO audit_log (account_id, action, detail) VALUES ($1, $2, $3)', [
        accountId,
        action,
        detail ? JSON.stringify(detail) : null
      ]);
    },

    async close() {
      await pool.end();
    }
  };
}

module.exports = { createPostgresStore };
