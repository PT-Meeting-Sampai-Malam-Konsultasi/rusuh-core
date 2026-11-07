const { problemError } = require('@/lib/problem');
const { normalizeNik, isValidNikFormat, maskNik, hmacNik, encryptNik } = require('@/lib/nik');
const { issueValidationToken } = require('./validation-token');

const MAX_ATTEMPTS_PER_MINUTE = 3;
const ATTEMPT_WINDOW_MS = 60 * 1000;
const MAX_SEATS_PER_NIK = 3;

/**
 * Attendee validation (LLD-02 §5.1, contract validateAttendee).
 * Checks, in order: 16-digit format + structure, not repeated in this
 * order, Dukcapil mock NIK-only (format + existence, 2 s timeout), and
 * this NIK holds < 3 seats for this event (ADR-0024).
 * A negative Dukcapil verdict BLOCKS the purchase (gating, 6 Nov item 4).
 * Success returns a short-lived validationToken (+ nikMasked) for the hold.
 *
 * @param {object} deps
 * @param {object} deps.store - Durable store (event lookup, nik backstop).
 * @param {object} deps.stock - Live stock adapter (NIK counters, validated set).
 * @param {object} deps.dukcapil - Dukcapil client (verify).
 * @param {string} deps.nikHmacKey - HMAC key for the NIK blind index.
 * @param {Buffer} deps.nikEncryptionKey - 32-byte key for NIK ciphertext + tokens.
 * @returns {object} Attendees service.
 */
function createAttendeesService({ store, stock, dukcapil, nikHmacKey, nikEncryptionKey }) {
  // Rate limit: 3 attempts/min per field per order (C-6). In-memory for v1;
  // a multi-replica deployment should move this to Valkey.
  const attempts = new Map(); // `${admissionToken}:${fieldIndex}` -> [timestamps]

  function checkRateLimit(admissionToken, fieldIndex, now = Date.now()) {
    const key = `${admissionToken}:${fieldIndex}`;
    const windowStart = now - ATTEMPT_WINDOW_MS;
    const recent = (attempts.get(key) || []).filter((t) => t > windowStart);
    if (recent.length >= MAX_ATTEMPTS_PER_MINUTE) return false;
    recent.push(now);
    attempts.set(key, recent);
    return true;
  }

  return {
    async validateAttendee(eventId, admission, { fieldIndex, fullName, nik }) {
      const event = await store.getEvent(eventId);
      if (!event) throw problemError('NOT_FOUND', 'No such resource for this caller.');

      if (!checkRateLimit(admission.token, fieldIndex)) {
        throw problemError('RATE_LIMITED', 'Slow down and retry after Retry-After seconds.', { retryAfter: 60 });
      }

      const normalized = normalizeNik(nik);
      if (!isValidNikFormat(normalized)) {
        throw problemError('NIK_INVALID', 'The NIK format is wrong, or the NIK was not found.');
      }

      const nikHmac = hmacNik(normalized, nikHmacKey);
      const alreadyValidated = await stock.getValidatedNiks(admission.token);
      if (alreadyValidated.includes(nikHmac)) {
        throw problemError('DUPLICATE_NIK', 'Each attendee in an order needs a different NIK.');
      }

      // Dukcapil mock, NIK-only (format + existence). Negative verdict BLOCKS.
      const verdict = await dukcapil.verify(normalized);
      if (!verdict.valid) {
        throw problemError('NIK_INVALID', 'The NIK format is wrong, or the NIK was not found.');
      }

      // Quota: this NIK holds < 3 seats for this event (live counter + backstop).
      const liveCount = await stock.getNikCount(eventId, nikHmac);
      const durableCount = await store.nikSeatCount(eventId, nikHmac);
      if (Math.max(liveCount, durableCount) >= MAX_SEATS_PER_NIK) {
        throw problemError('NIK_SEAT_TAKEN', 'This NIK already holds 3 seats for the event.');
      }

      await stock.addValidatedNik(admission.token, nikHmac);
      const nikMasked = maskNik(normalized);
      const nikCiphertext = encryptNik(normalized, nikEncryptionKey);
      const { validationToken, expiresAt } = issueValidationToken(
        { eventId, fieldIndex, fullName, nik: normalized, nikHmac, nikMasked },
        nikEncryptionKey
      );
      return { validationToken, nikMasked, expiresAt, nikHmac, nikCiphertext };
    }
  };
}

module.exports = { createAttendeesService };
