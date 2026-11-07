const crypto = require('crypto');

/**
 * @typedef {object} NikCrypto
 * @property {Function} decrypt - (ciphertext: string) => full NIK string. Throws on a malformed ciphertext or a failed auth tag.
 * @property {Function} encrypt - (plaintext: string) => ciphertext string (base64(iv):base64(data):base64(tag)).
 */

/**
 * NIK cryptography (D24). The ticket's NIK is stored in three forms: masked,
 * HMAC blind index, and ciphertext (AES-256-GCM). This module decrypts the
 * ciphertext for the officer reveal.
 *
 * Production keys come from KMS (envelope encryption: the data key is wrapped
 * by KMS). This implementation decrypts with a local 32-byte key (base64) from
 * NIK_ENCRYPTION_KEY — the dev/test stand-in for the KMS envelope. The KMS
 * envelope integration is a follow-up (noted in the README); the ciphertext
 * format is identical either way: base64(iv):base64(data):base64(tag).
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
      const [ivB64, dataB64, tagB64] = String(ciphertext).split(':');
      if (!ivB64 || !dataB64 || !tagB64) throw new Error('Malformed NIK ciphertext');
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return decipher.update(Buffer.from(dataB64, 'base64'), undefined, 'utf8') + decipher.final('utf8');
    },

    encrypt(plaintext) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return `${iv.toString('base64')}:${data.toString('base64')}:${cipher.getAuthTag().toString('base64')}`;
    }
  };
}

/**
 * Masks a 16-digit NIK as 4+4 (D15), in the openapi.yaml display format.
 *
 * @param {string} nik - Full 16-digit NIK.
 * @returns {string} Masked NIK, e.g. "3174 •••• •••• 0004".
 */
function maskNik(nik) {
  const value = String(nik);
  if (!/^\d{16}$/.test(value)) return '•••• •••• •••• ••••';
  return `${value.slice(0, 4)} •••• •••• ${value.slice(12)}`;
}

module.exports = { createNikCrypto, maskNik };
