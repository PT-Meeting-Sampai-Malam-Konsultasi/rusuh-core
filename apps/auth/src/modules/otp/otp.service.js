const crypto = require('crypto');
const { apiError } = require('@/lib/api-error');
const { issueSession } = require('@/lib/issue-session');
const {
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_SEND_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  OTP_CODE_LENGTH
} = require('./otp.constant');

/** HMAC-SHA256 of an OTP code (ADR-0006: HMAC + device-bound, hash only). */
function hmacCode(code, secret) {
  return crypto.createHmac('sha256', secret).update(code, 'utf8').digest('hex');
}

/** 6-digit numeric code from a CSPRNG. */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/**
 * OTP service (LLD-01 §5 + §7, openapi.yaml requestOtp/verifyOtp).
 *
 * @param {object} deps - { store, mailer, tokens, logger, otpSecret }.
 * @returns {object} { requestOtp, verifyOtp }.
 */
function createOtpService({ store, mailer, tokens, logger, otpSecret }) {
  const log = logger || { info: () => {}, error: () => {} };

  return {
    /**
     * Sends an OTP to an email. Always answers 202 with a challenge id
     * (no account enumeration). Rate limits (openapi.yaml): 60 s resend
     * cooldown, 3 sends per email per 10 minutes.
     */
    async requestOtp({ email, fullName, locale, deviceId }) {
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
        fullName: fullName || null,
        locale: locale || 'id',
        expiresAt: new Date(at.getTime() + OTP_TTL_MS)
      });
      // One active code per email: expire previous unused challenges.
      await store.expireOtpChallengesForEmail(normalized, challenge.id);

      try {
        await mailer.sendOtp({ to: normalized, code, locale: locale || 'id' });
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

      let profile = await store.findProfile(account.id);
      if (isNewAccount && challenge.fullName) {
        profile = await store.upsertProfile(account.id, { name: challenge.fullName, locale: challenge.locale });
        account.profileComplete = true;
      }

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

module.exports = { createOtpService, hmacCode, generateCode, normalizeEmail };
