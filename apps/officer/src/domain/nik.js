const { nikCrypto } = require('@rusuh/contracts');

/**
 * @typedef {object} NikCrypto
 * @property {Function} decrypt - (ciphertext: string) => full NIK string. Throws on a malformed ciphertext or a failed auth tag.
 * @property {Function} encrypt - (plaintext: string) => ciphertext string (base64url(iv + tag + ciphertext)).
 */

/**
 * NIK cryptography (D24). The ticket's NIK is stored in three forms: masked,
 * HMAC blind index, and ciphertext (AES-256-GCM). This module decrypts the
 * ciphertext for the officer reveal.
 *
 * The cipher and wire format live in @rusuh/contracts and are shared with
 * core-module (the writer): base64url(iv(12) + tag(16) + ciphertext). The
 * local 3-part iv:data:tag format this module once used could never decrypt
 * what core stores — do not reintroduce a local format.
 *
 * Production keys come from KMS (envelope encryption: the data key is wrapped
 * by KMS). This implementation uses a local 32-byte key (base64) from
 * NIK_ENCRYPTION_KEY — the dev/test stand-in for the KMS envelope; the
 * ciphertext format is identical either way.
 *
 * @param {object} options
 * @param {Buffer|string} options.key - 32-byte key (Buffer, or base64 string).
 * @returns {object} { decrypt, encrypt, maskNik }
 */
function createNikCrypto({ key }) {
  const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error('NIK_ENCRYPTION_KEY must be a 32-byte key (base64)');
  }

  return {
    decrypt(ciphertext) {
      return nikCrypto.decryptText(ciphertext, keyBuffer);
    },

    encrypt(plaintext) {
      return nikCrypto.encryptText(plaintext, keyBuffer);
    }
  };
}

/**
 * Masks a 16-digit NIK as 4+4 (D15), in the openapi.yaml display format.
 * Delegates to @rusuh/contracts (single canonical implementation).
 *
 * @param {string} nik - Full 16-digit NIK.
 * @returns {string} Masked NIK, e.g. "3174 •••• •••• 0004".
 */
function maskNik(nik) {
  return nikCrypto.maskNik(nik);
}

module.exports = { createNikCrypto, maskNik };
