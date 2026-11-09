/**
 * email_log dedup (LLD-04 §4): UNIQUE(booking_id, type), types TICKET/EXPIRED.
 * OTP does not use email_log (every OTP request is a new code).
 *
 * Claim pattern:
 * - new row -> 'claimed' (this worker sends)
 * - existing 'sent' -> 'duplicate' (skip, already sent)
 * - existing 'sending' and fresh -> 'in-flight' (another worker is sending; skip)
 * - existing 'sending' and stale -> 'claimed' (reclaim after a crashed worker)
 * - existing 'failed' -> 'claimed' (retry as a new claim)
 */

const EMAIL_LOG_DDL = `
CREATE TABLE IF NOT EXISTS email_log (
  booking_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('TICKET', 'EXPIRED')),
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  ses_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, type)
);
`;

/**
 * Decides what a claim attempt means for an existing email_log row.
 *
 * @param {object} row - Existing row ({status, updated_at}).
 * @param {number} staleMs - Age after which a 'sending' claim is stale.
 * @param {number} nowMs - Current time in ms.
 * @returns {string} 'duplicate' | 'in-flight' | 'claimed'.
 */
function decideClaim(row, staleMs, nowMs) {
  if (row.status === 'sent') return 'duplicate';
  if (row.status === 'sending') {
    const ageMs = nowMs - new Date(row.updated_at).getTime();
    return ageMs > staleMs ? 'claimed' : 'in-flight';
  }
  return 'claimed';
}

function toType(jobType) {
  return jobType === 'EMAIL_TICKET' ? 'TICKET' : 'EXPIRED';
}

/**
 * Postgres-backed email_log store.
 *
 * @param {object} options - Store dependencies.
 * @param {object} options.pool - pg Pool.
 * @param {number} [options.staleMinutes] - Stale-claim threshold (default 5).
 * @returns {object} Email log store.
 */
function createPostgresEmailLogStore({ pool, staleMinutes = 5 } = {}) {
  if (!pool) throw new Error('createPostgresEmailLogStore requires a pool');
  const staleMs = staleMinutes * 60 * 1000;

  return {
    ensureTable: async () => {
      await pool.query(EMAIL_LOG_DDL);
    },

    claim: async ({ bookingId, type }) => {
      const emailType = toType(type);
      const inserted = await pool.query(
        "INSERT INTO email_log (booking_id, type, status) VALUES ($1, $2, 'sending') ON CONFLICT DO NOTHING RETURNING *",
        [bookingId, emailType]
      );
      if (inserted.rows.length > 0) return { outcome: 'claimed', row: inserted.rows[0] };
      const existing = await pool.query('SELECT * FROM email_log WHERE booking_id = $1 AND type = $2', [
        bookingId,
        emailType
      ]);
      const row = existing.rows[0];
      if (!row) return { outcome: 'claimed', row: null };
      const decision = decideClaim(row, staleMs, Date.now());
      if (decision === 'claimed') {
        const reclaimed = await pool.query(
          "UPDATE email_log SET status = 'sending', updated_at = now() WHERE booking_id = $1 AND type = $2 RETURNING *",
          [bookingId, emailType]
        );
        return { outcome: 'claimed', row: reclaimed.rows[0] };
      }
      return { outcome: decision, row };
    },

    markSent: async ({ bookingId, type, sesMessageId }) => {
      await pool.query(
        "UPDATE email_log SET status = 'sent', ses_message_id = $3, updated_at = now() WHERE booking_id = $1 AND type = $2",
        [bookingId, toType(type), sesMessageId || null]
      );
    },

    markFailed: async ({ bookingId, type }) => {
      await pool.query(
        "UPDATE email_log SET status = 'failed', attempts = attempts + 1, updated_at = now() WHERE booking_id = $1 AND type = $2",
        [bookingId, toType(type)]
      );
    }
  };
}

/**
 * In-memory email_log store (same interface). Used for tests and as the
 * degraded fallback when DATABASE_URL is not configured.
 *
 * @param {object} options - Store options.
 * @param {number} [options.staleMinutes] - Stale-claim threshold (default 5).
 * @param {Function} [options.now] - Clock (tests).
 * @returns {object} Email log store.
 */
function createMemoryEmailLogStore({ staleMinutes = 5, now = () => Date.now() } = {}) {
  const staleMs = staleMinutes * 60 * 1000;
  const rows = new Map();

  return {
    ensureTable: async () => undefined,
    _rows: rows,

    claim: async ({ bookingId, type }) => {
      const emailType = toType(type);
      const key = `${bookingId}:${emailType}`;
      const existing = rows.get(key);
      if (!existing) {
        const row = {
          booking_id: bookingId,
          type: emailType,
          status: 'sending',
          ses_message_id: null,
          attempts: 0,
          updated_at: new Date(now()).toISOString()
        };
        rows.set(key, row);
        return { outcome: 'claimed', row };
      }
      const decision = decideClaim(existing, staleMs, now());
      if (decision === 'claimed') {
        existing.status = 'sending';
        existing.updated_at = new Date(now()).toISOString();
        return { outcome: 'claimed', row: existing };
      }
      return { outcome: decision, row: existing };
    },

    markSent: async ({ bookingId, type, sesMessageId }) => {
      const row = rows.get(`${bookingId}:${toType(type)}`);
      if (!row) return;
      row.status = 'sent';
      row.ses_message_id = sesMessageId || null;
      row.updated_at = new Date(now()).toISOString();
    },

    markFailed: async ({ bookingId, type }) => {
      const row = rows.get(`${bookingId}:${toType(type)}`);
      if (!row) return;
      row.status = 'failed';
      row.attempts += 1;
      row.updated_at = new Date(now()).toISOString();
    }
  };
}

module.exports = { createPostgresEmailLogStore, createMemoryEmailLogStore, decideClaim };
