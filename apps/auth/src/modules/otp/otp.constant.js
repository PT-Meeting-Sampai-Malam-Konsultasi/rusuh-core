/**
 * OTP constants (LLD-01 §7 + openapi.yaml limits).
 * Expiry 10 min (top of the decided 5–10 min range); resend cooldown 60 s;
 * 3 sends per email per 10 min; 5 verify attempts per challenge.
 */
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_WINDOW = 3;
const OTP_SEND_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_CODE_LENGTH = 6;

module.exports = {
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_SEND_WINDOW_MS,
  OTP_MAX_ATTEMPTS,
  OTP_CODE_LENGTH
};
