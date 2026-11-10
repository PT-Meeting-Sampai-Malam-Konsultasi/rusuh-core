const crypto = require('crypto');
const { nikCrypto } = require('@rusuh/contracts');

/**
 * NIK handling (D24): three stored forms per NIK.
 *  (1) masked plaintext — first 4 + last 4 digits, for display/log/error.
 *  (2) blind index — HMAC-SHA256(NIK) with a separate key, for quota lookup.
 *      The Lua script and the backstop DB only ever see the HMAC.
 *  (3) ciphertext — AES-256-GCM (the only reversible form, for officer view).
 *      The cipher + wire format live in @rusuh/contracts so officer-module
 *      (the reader) decrypts exactly what this module (the writer) stores.
 * Keys come from config (KMS in production; env-provided keys here).
 */

function normalizeNik(nik) {
  return String(nik || '').replace(/\s+/g, '');
}

function isValidNikFormat(nik) {
  const normalized = normalizeNik(nik);
  if (!/^\d{16}$/.test(normalized)) return false;
  // Birth-date component: day 01-31 (female +40 => 41-71), month 01-12.
  const day = Number(normalized.slice(6, 8));
  const month = Number(normalized.slice(8, 10));
  const year = Number(normalized.slice(10, 12));
  const isFemale = day >= 41 && day <= 71;
  const dayOfMonth = isFemale ? day - 40 : day;
  if (dayOfMonth < 1 || dayOfMonth > 31) return false;
  if (month < 1 || month > 12) return false;
  if (year < 0 || year > 99) return false;
  // Sequence number (last 4) must not be 0000.
  if (normalized.slice(12, 16) === '0000') return false;
  return true;
}

/**
 * Masked NIK for display (4+4, Q19): "3174 •••• •••• 0004".
 * Delegates to @rusuh/contracts (single canonical implementation).
 *
 * @param {string} nik - Full NIK.
 * @returns {string} Masked NIK.
 */
function maskNik(nik) {
  return nikCrypto.maskNik(nik);
}

/**
 * Blind index for quota lookup (HMAC-SHA256, D24).
 *
 * @param {string} nik - Full NIK.
 * @param {string|Buffer} key - HMAC key.
 * @returns {string} Hex HMAC.
 */
function hmacNik(nik, key) {
  return crypto.createHmac('sha256', key).update(normalizeNik(nik)).digest('hex');
}

/**
 * Encrypts arbitrary text (AES-256-GCM). Returns base64url(iv + tag + ciphertext).
 *
 * @param {string} text - Plaintext.
 * @param {Buffer} key - 32-byte encryption key.
 * @returns {string} Encrypted payload.
 */
function encryptText(text, key) {
  return nikCrypto.encryptText(text, key);
}

/**
 * Decrypts text encrypted with encryptText.
 *
 * @param {string} payload - base64url(iv + tag + ciphertext).
 * @param {Buffer} key - 32-byte encryption key.
 * @returns {string} Plaintext.
 */
function decryptText(payload, key) {
  return nikCrypto.decryptText(payload, key);
}

/**
 * Encrypts a NIK (AES-256-GCM, D24). Returns base64url(iv + tag + ciphertext).
 *
 * @param {string} nik - Full NIK.
 * @param {Buffer} key - 32-byte encryption key.
 * @returns {string} Encrypted payload.
 */
function encryptNik(nik, key) {
  return encryptText(normalizeNik(nik), key);
}

/**
 * Decrypts a NIK encrypted with encryptNik.
 *
 * @param {string} payload - base64url(iv + tag + ciphertext).
 * @param {Buffer} key - 32-byte encryption key.
 * @returns {string} Full NIK.
 */
function decryptNik(payload, key) {
  return decryptText(payload, key);
}

/**
 * Resolves the NIK encryption key from config.
 * Production: 32-byte key from KMS/Secrets Manager (base64 in env).
 * Dev/test: a fixed dev key is used and a warning is logged by the caller.
 *
 * @param {string} [base64Key] - Base64 32-byte key from env.
 * @returns {Buffer} 32-byte key.
 */
function resolveEncryptionKey(base64Key) {
  if (base64Key) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length === 32) return key;
    throw new Error('NIK_ENCRYPTION_KEY must be base64 of 32 bytes');
  }
  // Dev fallback: deterministic key, NEVER for production.
  return crypto.createHash('sha256').update('rusuh-dev-nik-key-do-not-use-in-production').digest();
}

module.exports = {
  normalizeNik,
  isValidNikFormat,
  maskNik,
  hmacNik,
  encryptText,
  decryptText,
  encryptNik,
  decryptNik,
  resolveEncryptionKey
};
