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
const NBSP = String.fromCharCode(160);

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

/**
 * Spaces a 6-digit OTP code for display: "482019" -> "482 019" with a
 * non-breaking space (U+00A0), so an HTML renderer can escape the value
 * without breaking the spacing (rusuh-web#46 variables table).
 *
 * @param {string} code - 6-digit code.
 * @returns {string} Spaced code.
 */
function spaceOtpCode(code) {
  return `${code.slice(0, 3)}${NBSP}${code.slice(3)}`;
}

/**
 * Formats an OTP expiry as a WIB clock time for the e-mail language
 * (rusuh-web#46: id "21.30 WIB", en "7.00 pm WIB"). WIB is UTC+7 year-round.
 *
 * @param {Date|string} expiresAt - Challenge expiry.
 * @param {string} locale - 'id' | 'en'.
 * @returns {string} Formatted clock time.
 */
function formatOtpExpiry(expiresAt, locale) {
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (locale === 'en') {
    // en-GB 12-hour renders "11:30 pm"; the design brief wants "11.30 pm WIB".
    const en = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
      .format(date)
      .replace(':', '.');
    return `${en} WIB`;
  }
  const id = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
  return `${id} WIB`;
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
  normalizeEmail,
  spaceOtpCode,
  formatOtpExpiry
};
