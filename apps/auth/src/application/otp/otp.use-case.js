const crypto = require('crypto');
const { apiError } = require('@/application/shared/api-error');
const { issueSession } = require('@/application/shared/issue-session');
const {
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_SEND_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  hmacCode,
  generateCode,
  normalizeEmail
} = require('@/domain/otp');

/**
 * OTP use case (LLD-01 §5 + §7, openapi.yaml requestOtp/verifyOtp).
 * Depends only on the domain ports (store, mailer, tokens, logger) —
 * the adapters are injected by the composition root (src/container.js).
 *
 * @param {object} deps - Use-case dependencies.
 * @param {import('@/domain/ports/store.port').AuthStore} deps.store - Repository.
 * @param {import('@/domain/ports/mailer.port').Mailer} deps.mailer - OTP delivery.
 * @param {import('@/domain/ports/token-service.port').TokenService} deps.tokens - JWT + refresh tokens.
 * @param {import('@/domain/ports/logger.port').Logger} deps.logger - Structured logger.
 * @param {string} deps.otpSecret - HMAC secret for OTP codes.
 * @returns {object} { requestOtp, verifyOtp }.
 */
function createOtpUseCase({ store, mailer, tokens, logger, otpSecret }) {
  const log = logger || { info: () => {}, error: () => {} };

  return {
    /**
     * Sends an OTP to an email. Always answers 202 with a challenge id
     * (no account enumeration). Rate limits (openapi.yaml): 60 s resend
     * cooldown, 3 sends per email per 10 minutes.
     */
    async requestOtp({ email, locale, deviceId }) {
      const normalized = normalizeEmail(email);
      const at = new Date();

      const latest = await store.findLatestOtpChallengeByEmail(normalized);
      if (latest && at - latest.createdAt < OTP_RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_MS - (at - latest.createdAt)) / 1000);
        throw apiError('TOO_MANY_REQUESTS', 'Tunggu sebelum meminta kode lagi', { retryAfter });
      }
      const sentCount = await store.countOtpChallengesSince(normalized, new Date(at.getTime() - OTP_SEND_WINDOW_MS));
      if (sentCount >= OTP_MAX_SENDS_PER_WINDOW) {
        throw apiError('TOO_MANY_REQUESTS', 'Terlalu banyak permintaan kode, coba lagi nanti');
      }

      const code = generateCode();
      const challenge = await store.createOtpChallenge({
        email: normalized,
        codeHash: hmacCode(code, otpSecret),
        deviceId: deviceId || null,
        locale: locale || 'id',
        expiresAt: new Date(at.getTime() + OTP_TTL_MS)
      });
      // One active code per email: expire previous unused challenges.
      await store.expireOtpChallengesForEmail(normalized, challenge.id);

      try {
        await mailer.sendOtp({ to: normalized, code, locale: locale || 'id', expiresAt: challenge.expiresAt });
      } catch (error) {
        // The code was never delivered: drop the challenge so a retry is
        // not rate-limited, and answer 503 retryable (LLD-01 §7).
        await store.deleteOtpChallenge(challenge.id);
        log.error('OTP mailer failed');
        throw apiError('SERVICE_UNAVAILABLE', 'Pengiriman kode gagal, coba lagi');
      }

      log.info('otp_requested');
      return {
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt.toISOString(),
        resendAfterSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000)
      };
    },

    /**
     * Verifies an OTP code. Accepts {challengeId, code} (openapi.yaml) or
     * {email, code} (LLD-01 alias: resolves to the latest active challenge).
     * On success finds or creates the account and issues a Session.
     */
    async verifyOtp({ challengeId, email, code, deviceId }) {
      const normalizedEmail = email ? normalizeEmail(email) : null;
      let challenge = null;
      if (challengeId) {
        challenge = await store.findOtpChallengeById(challengeId);
      } else if (normalizedEmail) {
        challenge = await store.findLatestOtpChallengeByEmail(normalizedEmail);
      }
      if (!challenge) throw apiError('CHALLENGE_EXPIRED', 'Kode sudah kedaluwarsa, minta kode baru');

      const at = new Date();
      if (challenge.deviceId && deviceId && challenge.deviceId !== deviceId) {
        throw apiError('UNAUTHORIZED', 'Kode tidak cocok dengan perangkat ini');
      }
      if (challenge.usedAt) throw apiError('CHALLENGE_EXPIRED', 'Kode sudah dipakai, minta kode baru');
      if (challenge.expiresAt <= at) throw apiError('CHALLENGE_EXPIRED', 'Kode sudah kedaluwarsa, minta kode baru');
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        throw apiError('CHALLENGE_LOCKED', 'Terlalu banyak percobaan, minta kode baru');
      }

      const expected = Buffer.from(challenge.codeHash, 'hex');
      const actual = Buffer.from(hmacCode(code, otpSecret), 'hex');
      const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
      if (!matches) {
        const attempts = challenge.attempts + 1;
        await store.updateOtpChallenge(challenge.id, { attempts });
        if (attempts >= OTP_MAX_ATTEMPTS) {
          throw apiError('CHALLENGE_LOCKED', 'Terlalu banyak percobaan, minta kode baru');
        }
        throw apiError('WRONG_CODE', 'Kode salah', { attemptsLeft: OTP_MAX_ATTEMPTS - attempts });
      }

      const isNewAccount = !(await store.findAccountByEmail(challenge.email));
      const purpose = isNewAccount ? 'register' : 'login';
      await store.updateOtpChallenge(challenge.id, { usedAt: at, purpose });

      let account = await store.findAccountByEmail(challenge.email);
      if (!account) {
        account = await store.createAccount({ email: challenge.email });
      }

      const profile = await store.findProfile(account.id);

      log.info('otp_verified');
      const session = await issueSession({
        store,
        tokens,
        account,
        profile,
        deviceLabel: deviceId ? `device:${deviceId}` : null,
        isNewAccount
      });
      return session;
    }
  };
}

module.exports = { createOtpUseCase };
