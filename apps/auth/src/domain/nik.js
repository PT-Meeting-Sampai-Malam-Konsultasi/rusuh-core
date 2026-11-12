const crypto = require('crypto');
const { nikCrypto } = require('@rusuh/contracts');

/**
 * NIK handling for the profile (ADR-0031: an account may store its own NIK,
 * optional and encrypted, so "Saya sendiri" and "Simpan NIK ini ke profil"
 * work without retyping it every purchase).
 * Mirrors apps/core/src/domain/nik.js — the cipher + wire format live in
 * @rusuh/contracts so core-module (the reader at purchase time) decrypts
 * exactly what this module (the writer) stores. Only the masked form is
 * ever returned by the API; the full NIK is never exposed.
 * Keys come from config (KMS in production; env-provided keys here).
 */

/** Strips whitespace (users paste NIK with spaces). */
function normalizeNik(nik) {
  return String(nik || '').replace(/\s+/g, '');
}

/**
 * Indonesian NIK format check (same rules as core): 16 digits, a valid
 * birth-date component (day 01-31, female +40 => 41-71; month 01-12) and a
 * sequence number that is not 0000. Format-only; Dukcapil verification
 * happens at purchase time (validateAttendee).
 */
function isValidNikFormat(nik) {
  const normalized = normalizeNik(nik);
  if (!/^\d{16}$/.test(normalized)) return false;
  const day = Number(normalized.slice(6, 8));
  const month = Number(normalized.slice(8, 10));
  const year = Number(normalized.slice(10, 12));
  const isFemale = day >= 41 && day <= 71;
  const dayOfMonth = isFemale ? day - 40 : day;
  if (dayOfMonth < 1 || dayOfMonth > 31) return false;
  if (month < 1 || month > 12) return false;
  if (year < 0 || year > 99) return false;
  if (normalized.slice(12, 16) === '0000') return false;
  return true;
}

/** Masked NIK for display (4+4, Q19): "3174 •••• •••• 0004". */
function maskNik(nik) {
  return nikCrypto.maskNik(nik);
}

/** Encrypts a NIK (AES-256-GCM). Returns base64url(iv + tag + ciphertext). */
function encryptNik(nik, key) {
  return nikCrypto.encryptText(normalizeNik(nik), key);
}

/** Decrypts a NIK encrypted with encryptNik. Returns the full NIK. */
function decryptNik(payload, key) {
  return nikCrypto.decryptText(payload, key);
}

/**
 * Resolves the NIK encryption key from config.
 * Production: 32-byte key from KMS/Secrets Manager (base64 in env).
 * Dev/test: a fixed dev key is used and a warning is logged by the caller.
 * MUST be the same key core-module uses, so the profile NIK decrypts
 * exactly like a transaction NIK.
 */
function resolveEncryptionKey(base64Key) {
  if (base64Key) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length === 32) return key;
    throw new Error('NIK_ENCRYPTION_KEY must be base64 of 32 bytes');
  }
  return crypto.createHash('sha256').update('rusuh-dev-nik-key-do-not-use-in-production').digest();
}

module.exports = {
  normalizeNik,
  isValidNikFormat,
  maskNik,
  encryptNik,
  decryptNik,
  resolveEncryptionKey
};
