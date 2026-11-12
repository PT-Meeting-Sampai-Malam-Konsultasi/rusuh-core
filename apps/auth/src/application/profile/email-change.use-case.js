const crypto = require('crypto');
const { apiError } = require('@/application/shared/api-error');
const {
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_SEND_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  hmacCode,
  generateCode,
  normalizeEmail,
  formatOtpValidity
} = require('@/domain/otp');

/**
 * Compares an OTP code against its stored HMAC in constant time.
 *
 * @param {string} code - Submitted 6-digit code.
 * @param {string} hash - Stored hex HMAC.
 * @param {string} secret - HMAC secret.
 * @returns {boolean} True when the code matches.
 */
function codeMatches(code, hash, secret) {
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(hmacCode(code, secret), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * Email-change use case (openapi.yaml startEmailChange / verifyEmailChange).
 * Two OTP codes are issued, one to the current and one to the new address;
 * the email is swapped only when both are confirmed.
 *
 * @param {object} deps - Use-case dependencies.
 * @param {import('@/domain/ports/store.port').AuthStore} deps.store - Repository.
 * @param {import('@/domain/ports/mailer.port').Mailer} deps.mailer - OTP delivery.
 * @param {import('@/domain/ports/logger.port').Logger} deps.logger - Structured logger.
 * @param {string} deps.otpSecret - HMAC secret for OTP codes.
 * @param {number} [deps.otpTtlMs] - Code lifetime in ms.
 * @returns {object} { startEmailChange, verifyEmailChange }.
 */
function createEmailChangeUseCase({ store, mailer, logger, otpSecret, otpTtlMs = OTP_TTL_MS }) {
  const log = logger || { info: () => {}, error: () => {} };

  const toUser = (account, profile) => ({
    userId: account.id,
    email: account.email,
    fullName: profile?.name ?? null,
    locale: profile?.locale ?? 'id'
  });

  return {
    /**
     * Starts an email change: validates the new address, rate-limits per
     * account (same limits as OTP), stores both code hashes and mails a code
     * to each address.
     *
     * @param {object} input - { accountId, newEmail }.
     * @returns {Promise<object>} { challengeId, expiresAt, resendAfterSeconds }.
     */
    async startEmailChange({ accountId, newEmail }) {
      const account = await store.findAccountById(accountId);
      if (!account) throw apiError('UNAUTHORIZED', 'Akun tidak ditemukan');

      const target = normalizeEmail(newEmail);
      if (target === account.email) throw apiError('BAD_REQUEST', 'Email baru sama dengan email saat ini');
      if (await store.findAccountByEmail(target)) throw apiError('CONFLICT', 'Email sudah dipakai akun lain');

      const at = new Date();
      const latest = await store.findLatestEmailChangeByAccount(accountId);
      if (latest && at - latest.createdAt < OTP_RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_MS - (at - latest.createdAt)) / 1000);
        throw apiError('TOO_MANY_REQUESTS', 'Tunggu sebelum meminta kode lagi', { retryAfter });
      }
      const sent = await store.countEmailChangesSince(accountId, new Date(at.getTime() - OTP_SEND_WINDOW_MS));
      if (sent >= OTP_MAX_SENDS_PER_WINDOW) {
        throw apiError('TOO_MANY_REQUESTS', 'Terlalu banyak permintaan kode, coba lagi nanti');
      }

      const profile = await store.findProfile(accountId);
      const locale = profile?.locale || 'id';
      const oldCode = generateCode();
      const newCode = generateCode();
      const challenge = await store.createEmailChange({
        accountId,
        newEmail: target,
        oldCodeHash: hmacCode(oldCode, otpSecret),
        newCodeHash: hmacCode(newCode, otpSecret),
        locale,
        expiresAt: new Date(at.getTime() + otpTtlMs)
      });
      await store.expireEmailChangesForAccount(accountId, challenge.id);

      const common = {
        locale,
        expiresAt: challenge.expiresAt,
        validFor: formatOtpValidity(otpTtlMs, locale)
      };
      try {
        await mailer.sendOtp({ to: account.email, code: oldCode, ...common });
        await mailer.sendOtp({ to: target, code: newCode, ...common });
      } catch (error) {
        await store.deleteEmailChange(challenge.id);
        log.error('Email change mailer failed');
        throw apiError('SERVICE_UNAVAILABLE', 'Pengiriman kode gagal, coba lagi');
      }

      await store.createAuditLog({ accountId, action: 'email_change_requested', detail: { challengeId: challenge.id } });
      log.info('email_change_requested');
      return {
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt.toISOString(),
        resendAfterSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000)
      };
    },

    /**
     * Confirms an email change with both codes and swaps the account email.
     * A wrong code in either field counts one attempt on the challenge.
     *
     * @param {object} input - { accountId, challengeId, oldEmailCode, newEmailCode }.
     * @returns {Promise<object>} Updated User { userId, email, fullName, locale }.
     */
    async verifyEmailChange({ accountId, challengeId, oldEmailCode, newEmailCode }) {
      const challenge = await store.findEmailChangeById(challengeId);
      // A challenge of another account is reported as unknown, never as foreign.
      if (!challenge || challenge.accountId !== accountId) {
        throw apiError('CHALLENGE_EXPIRED', 'Kode sudah kedaluwarsa, minta kode baru');
      }
      const at = new Date();
      if (challenge.usedAt) throw apiError('CHALLENGE_EXPIRED', 'Kode sudah dipakai, minta kode baru');
      if (challenge.expiresAt <= at) throw apiError('CHALLENGE_EXPIRED', 'Kode sudah kedaluwarsa, minta kode baru');
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        throw apiError('CHALLENGE_LOCKED', 'Terlalu banyak percobaan, minta kode baru');
      }

      const oldOk = codeMatches(oldEmailCode, challenge.oldCodeHash, otpSecret);
      const newOk = codeMatches(newEmailCode, challenge.newCodeHash, otpSecret);
      if (!oldOk || !newOk) {
        const attempts = challenge.attempts + 1;
        await store.updateEmailChange(challenge.id, { attempts });
        if (attempts >= OTP_MAX_ATTEMPTS) {
          throw apiError('CHALLENGE_LOCKED', 'Terlalu banyak percobaan, minta kode baru');
        }
        throw apiError('WRONG_CODE', 'Kode salah', { attemptsLeft: OTP_MAX_ATTEMPTS - attempts });
      }

      let account;
      try {
        account = await store.updateAccountEmail(accountId, challenge.newEmail);
      } catch (error) {
        if (error.code === 'EMAIL_TAKEN') throw apiError('CONFLICT', 'Email sudah dipakai akun lain');
        throw error;
      }
      if (!account) throw apiError('UNAUTHORIZED', 'Akun tidak ditemukan');
      await store.updateEmailChange(challenge.id, { usedAt: at });
      await store.createAuditLog({
        accountId,
        action: 'email_changed',
        detail: { challengeId: challenge.id }
      });
      log.info('email_changed');
      return toUser(account, await store.findProfile(accountId));
    }
  };
}

module.exports = { createEmailChangeUseCase };
