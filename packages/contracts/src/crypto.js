const crypto = require('crypto');

/**
 * Shared AES-256-GCM crypto for the NIK ciphertext (D24).
 *
 * Canonical wire format: base64url(iv(12) + tag(16) + ciphertext) — one
 * opaque blob. core-module writes it (booking creation) and officer-module
 * reads it (gate reveal), so both MUST share these functions instead of
 * keeping local copies: the two implementations drifted once (officer
 * expected iv:data:tag) and every gate scan failed with 503 until the
 * formats were unified here.
 *
 * Keys are 32 bytes (env-provided dev stand-in for the KMS envelope; the
 * format is identical either way).
 */

/**
 * Encrypts arbitrary text (AES-256-GCM).
 *
 * @param {string} text - Plaintext.
 * @param {Buffer} key - 32-byte encryption key.
 * @returns {string} base64url(iv + tag + ciphertext).
 */
function encryptText(text, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/**
 * Decrypts text encrypted with encryptText. Any tampering fails the GCM
 * auth tag; a payload shorter than iv+tag is malformed input.
 *
 * @param {string} payload - base64url(iv + tag + ciphertext).
 * @param {Buffer} key - 32-byte encryption key.
 * @returns {string} Plaintext.
 * @throws {Error} 'Malformed ciphertext' when the payload is too short,
 *   or the crypto error from a failed auth tag.
 */
function decryptText(payload, key) {
  const buffer = Buffer.from(String(payload), 'base64url');
  if (buffer.length < 12 + 16) throw new Error('Malformed ciphertext');
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Masks a 16-digit NIK as 4+4 for display/log (D15, Q19): "3174 •••• •••• 0004".
 *
 * @param {string} nik - Full NIK (whitespace tolerated).
 * @returns {string} Masked NIK.
 */
function maskNik(nik) {
  const normalized = String(nik || '').replace(/\s+/g, '');
  if (normalized.length !== 16) return '•••• •••• •••• ••••';
  return `${normalized.slice(0, 4)} •••• •••• ${normalized.slice(12)}`;
}

module.exports = { encryptText, decryptText, maskNik };
