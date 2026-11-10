const { encryptText, decryptText } = require('@/domain/nik');

/**
 * Validation token (LLD-02 §5.1): a short-lived, stateless token that carries
 * the attendee name + NIK for one order field. The payload is encrypted
 * (AES-256-GCM, same key as the NIK ciphertext) so any core replica can
 * recover it without shared server-side state.
 * Format: av_<base64url(iv + tag + ciphertext(JSON))>.
 * The token lives until the end of the order window (5 min from issue).
 */

const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Issues a validation token.
 *
 * @param {object} attendee - { eventId, fieldIndex, fullName, nik, nikHmac, nikMasked }.
 * @param {Buffer} key - 32-byte encryption key.
 * @param {number} [nowMs] - Override for current time (tests).
 * @returns {{validationToken: string, expiresAt: string}} Token + expiry (ISO 8601).
 */
function issueValidationToken(attendee, key, nowMs = Date.now()) {
  const expiresAt = new Date(nowMs + TOKEN_TTL_MS).toISOString();
  const payload = JSON.stringify({
    eventId: attendee.eventId,
    fieldIndex: attendee.fieldIndex,
    fullName: attendee.fullName,
    nik: attendee.nik,
    nikHmac: attendee.nikHmac,
    nikMasked: attendee.nikMasked,
    expiresAt
  });
  const validationToken = `av_${encryptText(payload, key)}`;
  return { validationToken, expiresAt };
}

/**
 * Verifies a validation token and recovers the attendee.
 *
 * @param {string} token - Validation token.
 * @param {Buffer} key - 32-byte encryption key.
 * @param {number} [nowMs] - Override for current time (tests).
 * @returns {object|null} Attendee payload, or null when invalid/expired.
 */
function verifyValidationToken(token, key, nowMs = Date.now()) {
  if (typeof token !== 'string' || !token.startsWith('av_')) return null;
  try {
    const payload = JSON.parse(decryptText(token.slice(3), key));
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.eventId || typeof payload.fieldIndex !== 'number' || !payload.nik || !payload.nikHmac) return null;
    if (new Date(payload.expiresAt).getTime() <= nowMs) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

module.exports = { issueValidationToken, verifyValidationToken, TOKEN_TTL_MS };
