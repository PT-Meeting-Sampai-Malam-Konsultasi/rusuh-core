/**
 * Audit log writer (LLD-05 §3.2, D18). One row per sensitive officer/admin
 * action. The full NIK is NEVER written here — only the action + nik_masked
 * (the log records THAT a full NIK was viewed, not its value).
 *
 * Assumed schema (LLD-02; implemented in core-module):
 *   audit_log(id BIGSERIAL, created_at TIMESTAMPTZ, actor_account_id TEXT,
 *     actor_role TEXT, action TEXT, ticket_id TEXT, booking_id TEXT,
 *     event_id TEXT, nik_masked TEXT, details JSONB)
 *
 * Audit entry:
 *   { actorAccountId, actorRole, action, ticketId?, bookingId?, eventId?,
 *     nikMasked?, details? }
 */

/**
 * Postgres audit store.
 *
 * @param {object} pool - pg Pool.
 * @returns {object} AuditStore.
 */
function createPostgresAuditStore(pool) {
  return {
    async insert(entry) {
      const { rows } = await pool.query(
        `INSERT INTO audit_log
           (actor_account_id, actor_role, action, ticket_id, booking_id, event_id, nik_masked, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [
          entry.actorAccountId,
          entry.actorRole,
          entry.action,
          entry.ticketId || null,
          entry.bookingId || null,
          entry.eventId || null,
          entry.nikMasked || null,
          JSON.stringify(entry.details || {})
        ]
      );
      return { ...entry, id: rows[0].id, createdAt: new Date(rows[0].created_at).toISOString() };
    },

    async list() {
      throw new Error('audit list is not exposed by this store');
    }
  };
}

/**
 * In-memory audit store (tests + local dev without a database).
 *
 * @returns {object} AuditStore (with _entries for assertions).
 */
function createMemoryAuditStore() {
  const entries = [];
  return {
    _entries: entries,

    async insert(entry) {
      const stored = {
        ...entry,
        id: entries.length + 1,
        createdAt: new Date().toISOString(),
        details: entry.details || {}
      };
      entries.push(stored);
      return { ...stored };
    },

    async list() {
      return entries.map((entry) => ({ ...entry }));
    }
  };
}

module.exports = { createPostgresAuditStore, createMemoryAuditStore };
