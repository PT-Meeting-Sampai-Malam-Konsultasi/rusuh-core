/* eslint-disable no-bitwise -- base32 encoding is inherently bitwise (shifts/masks). */
const crypto = require('crypto');

/**
 * Opaque id generation. Prefixes follow the repo contract:
 *  bk_ booking, tk_ ticket, av_ validation token, adm_ admission token,
 *  s_ slot, evt_ event, cat_ category, ord_ order code is RSH-YY-NNNNNN.
 * Ids are time-ordered (millisecond timestamp + random) so they sort
 * roughly by creation time without leaking a sequence.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I/L/O/U

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  buffer.forEach((byte) => {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  });
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function generateId(prefix) {
  const timestamp = BigInt(Date.now());
  const timeBytes = Buffer.alloc(6);
  timeBytes.writeUIntBE(Number(timestamp % 281474976710656n), 0, 6);
  const random = crypto.randomBytes(6);
  return `${prefix}${base32Encode(Buffer.concat([timeBytes, random]))}`;
}

function generateBookingId() {
  return generateId('bk_');
}

function generateTicketId() {
  return generateId('tk_');
}

function generateOrderCode() {
  const year = String(new Date().getFullYear()).slice(2, 4);
  const sequence = String(Math.floor(Math.random() * 900000) + 100000);
  return `RSH-${year}-${sequence}`;
}

/**
 * Public ticket code (D19): {EVENT_CODE}-{CATEGORY_CODE}-{SEQ:05d}.
 * Minted only when the payment succeeds.
 *
 * @param {string} eventCode - Short event code (e.g. SMD).
 * @param {string} categoryCode - Short category code (e.g. FB).
 * @param {number} sequence - Per-category sequence (1-based).
 * @returns {string} Ticket code (e.g. SMD-FB-04827).
 */
function ticketCode(eventCode, categoryCode, sequence) {
  return `${eventCode}-${categoryCode}-${String(sequence).padStart(5, '0')}`;
}

/**
 * QR payload (Q22): the QR carries the ticket id, signed so the gate can
 * verify it offline. Format: RSH1.<ticketCode>.<base64url(HMAC)>.
 *
 * @param {string} code - Public ticket code.
 * @param {string|Buffer} key - HMAC key.
 * @returns {string} QR payload.
 */
function qrPayload(code, key) {
  const signature = crypto.createHmac('sha256', key).update(code).digest().toString('base64url');
  return `RSH1.${code}.${signature}`;
}

module.exports = { generateId, generateBookingId, generateTicketId, generateOrderCode, ticketCode, qrPayload };
