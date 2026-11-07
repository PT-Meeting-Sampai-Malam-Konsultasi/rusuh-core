const crypto = require('crypto');

/**
 * OTP domain rules (LLD-01 §7 + openapi.yaml limits).
 * Expiry 10 min (top of the decided 5–10 min range); resend cooldown 60 s;
 * 3 sends per email per 10 min; 5 verify attempts per challenge.
 *
 * Pure: no I/O, no adapters — the use cases in application/ apply these
 * rules against the store/mailer/token ports.
 */
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_WINDOW = 3;
const OTP_SEND_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_CODE_LENGTH = 6;

/** HMAC-SHA256 of an OTP code (ADR-0006: HMAC + device-bound, hash only). */
function hmacCode(code, secret) {
  return crypto.createHmac('sha256', secret).update(code, 'utf8').digest('hex');
}

/** 6-digit numeric code from a CSPRNG. */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');
}

/** Canonical email form (trimmed, lower-cased) used as the lookup key. */
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

module.exports = {
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_SEND_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  OTP_CODE_LENGTH,
  hmacCode,
  generateCode,
  normalizeEmail
};
