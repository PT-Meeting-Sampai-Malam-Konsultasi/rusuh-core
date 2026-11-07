const crypto = require('crypto');

/**
 * Computes the Midtrans signature_key.
 * signature_key = SHA512(order_id + status_code + gross_amount + serverKey).
 * gross_amount is used exactly as Midtrans sends it (e.g. "1505000.00").
 *
 * @param {object} input - Signature inputs.
 * @param {string} input.orderId - Midtrans order_id ({booking_id}-{attempt}).
 * @param {string} input.statusCode - Midtrans status_code (e.g. "200").
 * @param {string} input.grossAmount - Midtrans gross_amount string.
 * @param {string} input.serverKey - Midtrans Server Key (backend-only, never logged).
 * @returns {string} Hex SHA-512 digest.
 */
function computeSignatureKey({ orderId, statusCode, grossAmount, serverKey }) {
  const input = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  return crypto.createHash('sha512').update(input, 'utf8').digest('hex');
}

/**
 * Verifies a Midtrans signature_key with a constant-time comparison.
 *
 * @param {object} input - Signature inputs plus the claimed signature.
 * @param {string} input.signatureKey - Claimed signature_key from the webhook.
 * @returns {boolean} True when the signature matches.
 */
function verifySignatureKey({ orderId, statusCode, grossAmount, serverKey, signatureKey }) {
  if (typeof signatureKey !== 'string' || signatureKey.length === 0) return false;
  if (typeof serverKey !== 'string' || serverKey.length === 0) return false;
  const expected = computeSignatureKey({ orderId, statusCode, grossAmount, serverKey });
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signatureKey, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = { computeSignatureKey, verifySignatureKey };
