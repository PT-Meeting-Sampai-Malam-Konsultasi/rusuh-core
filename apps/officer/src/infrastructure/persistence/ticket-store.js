const { Pool } = require('pg');

/**
 * Ticket store (Postgres is the source of truth for tickets, D19).
 *
 * Assumed schema (LLD-02; implemented in core-module — see README for the DDL):
 *   tickets(id, public_code, booking_id, event_id, category_id, category_name,
 *     gate, seating, holder_name, nik_masked, nik_hmac, nik_cipher,
 *     status, used_at, used_by, issued_at)
 *   events(id, name, date)
 *
 * Ticket record returned by the store:
 *   { id, publicCode, bookingId, eventId, eventName, eventDate (YYYY-MM-DD),
 *     categoryId, categoryName, gate, seating, holderName, nikMasked,
 *     nikCipher, status ('unused'|'used'), usedAt, usedBy, issuedAt }
 */

/**
 * Maps a DB row to a ticket record.
 *
 * @param {object} row - Postgres row (tickets joined with events).
 * @returns {object} Ticket record.
 */
function rowToTicket(row) {
  return {
    id: row.id,
    publicCode: row.public_code,
    bookingId: row.booking_id,
    eventId: row.event_id,
    eventName: row.event_name || null,
    eventDate: row.event_date ? String(row.event_date).slice(0, 10) : null,
    categoryId: row.category_id,
    categoryName: row.category_name,
    gate: row.gate || null,
    seating: row.seating || null,
    holderName: row.holder_name,
    nikMasked: row.nik_masked,
    nikCipher: row.nik_cipher,
    status: row.status,
    usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    usedBy: row.used_by || null,
    issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null
  };
}

const TICKET_COLUMNS = `
  t.id, t.public_code, t.booking_id, t.event_id, e.name AS event_name,
  e.date AS event_date, t.category_id, t.category_name, t.gate, t.seating,
  t.holder_name, t.nik_masked, t.nik_cipher, t.status, t.used_at, t.used_by,
  t.issued_at
`;

/**
 * Postgres ticket store.
 *
 * @param {object} pool - pg Pool.
 * @returns {object} TicketStore.
 */
function createPostgresTicketStore(pool) {
  return {
    async findByCodeOrId(codeOrId) {
      const { rows } = await pool.query(
        `SELECT ${TICKET_COLUMNS} FROM tickets t LEFT JOIN events e ON e.id = t.event_id
         WHERE t.public_code = $1 OR t.id = $1 LIMIT 1`,
        [codeOrId]
      );
      return rows.length === 0 ? null : rowToTicket(rows[0]);
    },

    async findEvent(eventId) {
      const { rows } = await pool.query('SELECT id, name, date FROM events WHERE id = $1', [eventId]);
      if (rows.length === 0) return null;
      return { id: rows[0].id, name: rows[0].name, date: String(rows[0].date).slice(0, 10) };
    },

    async markUsed(codeOrId, { usedBy }) {
      // Atomic check-and-mark (D15): exactly one officer wins the race.
      const updated = await pool.query(
        `UPDATE tickets SET status = 'used', used_at = now(), used_by = $2
         WHERE (public_code = $1 OR id = $1) AND status = 'unused'
         RETURNING id`,
        [codeOrId, usedBy]
      );
      if (updated.rows.length === 1) {
        const ticket = await this.findByCodeOrId(codeOrId);
        return { ticket, alreadyUsed: false };
      }
      const ticket = await this.findByCodeOrId(codeOrId);
      if (!ticket) return null;
      return { ticket, alreadyUsed: true };
    },

    async listByEvent(eventId, { page, limit }) {
      const offset = (page - 1) * limit;
      const counted = await pool.query('SELECT COUNT(*) AS total FROM tickets WHERE event_id = $1', [eventId]);
      const { rows } = await pool.query(
        `SELECT ${TICKET_COLUMNS} FROM tickets t LEFT JOIN events e ON e.id = t.event_id
         WHERE t.event_id = $1 ORDER BY t.issued_at ASC LIMIT $2 OFFSET $3`,
        [eventId, limit, offset]
      );
      return { items: rows.map(rowToTicket), total: Number(counted.rows[0].total) };
    }
  };
}

/**
 * In-memory ticket store (tests + local dev without a database).
 * Same interface as the Postgres store; markUsed is atomic in-process
 * (single-threaded Node — no concurrent writers inside one process).
 *
 * @param {object[]} [seedTickets] - Initial ticket records.
 * @param {object[]} [seedEvents] - Initial events ({ id, name, date }).
 * @returns {object} TicketStore (with _seed helpers for tests).
 */
function createMemoryTicketStore(seedTickets = [], seedEvents = []) {
  const byCode = new Map();
  const byId = new Map();
  const events = new Map();
  const seed = (tickets) => {
    tickets.forEach((ticket) => {
      const record = { ...ticket };
      byCode.set(record.publicCode, record);
      byId.set(record.id, record);
    });
  };
  seedEvents.forEach((event) => events.set(event.id, { ...event }));
  seed(seedTickets);

  return {
    _seed: seed,
    _seedEvents: (list) => list.forEach((event) => events.set(event.id, { ...event })),

    async findByCodeOrId(codeOrId) {
      return byCode.get(codeOrId) || byId.get(codeOrId) || null;
    },

    async findEvent(eventId) {
      return events.get(eventId) || null;
    },

    async markUsed(codeOrId, { usedBy }) {
      const ticket = byCode.get(codeOrId) || byId.get(codeOrId) || null;
      if (!ticket) return null;
      if (ticket.status === 'used') return { ticket: { ...ticket }, alreadyUsed: true };
      ticket.status = 'used';
      ticket.usedAt = new Date().toISOString();
      ticket.usedBy = usedBy;
      return { ticket: { ...ticket }, alreadyUsed: false };
    },

    async listByEvent(eventId, { page, limit }) {
      const all = [...byCode.values()]
        .filter((ticket) => ticket.eventId === eventId)
        .sort((a, b) => String(a.issuedAt).localeCompare(String(b.issuedAt)));
      const offset = (page - 1) * limit;
      return { items: all.slice(offset, offset + limit).map((ticket) => ({ ...ticket })), total: all.length };
    }
  };
}

/**
 * Builds a pg Pool from a connection string (lazy: no connection until first query).
 *
 * @param {string} connectionString - Postgres connection string.
 * @returns {object} pg Pool.
 */
function createPool(connectionString) {
  return new Pool({ connectionString });
}

module.exports = { createPostgresTicketStore, createMemoryTicketStore, createPool, rowToTicket };
