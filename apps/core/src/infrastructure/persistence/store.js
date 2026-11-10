/* eslint-disable max-classes-per-file -- Memory + Postgres stores share one interface per file by design. */
const { Pool } = require('pg');

/**
 * Durable store (Postgres, D10). Two implementations behind one interface:
 *  - MemoryStore: in-memory, used when DATABASE_URL is not set (tests, local dev).
 *  - PgStore: node-postgres, used when DATABASE_URL is set.
 *
 * Booking states (internal): SELECTION, PAYMENT_PENDING, PAID, EXPIRED, CANCELLED.
 * The public API exposes SELECTION / PAYMENT_PENDING as well — the yaml
 * BookingStatus enum ([HELD, PAID, EXPIRED, CANCELLED]) needs extending to
 * cover them (flagged in the module report; see bookings.presenter).
 *
 * NIK is stored in three forms (D24): masked, HMAC blind index, ciphertext.
 * The store never receives a raw NIK — callers HMAC/encrypt first.
 */

function nowIso() {
  return new Date().toISOString();
}

/** Seed event matching the openapi.yaml example (Samudra, GBK). */
function seedData() {
  const event = {
    eventId: 'evt_2026_gbk',
    name: 'Samudra',
    subtitle: 'Tur Gelombang 2026',
    format: 'Tour',
    venue: 'Stadion Utama GBK',
    venueShort: 'GBK',
    city: 'Jakarta',
    timezone: 'Asia/Jakarta',
    startsAt: '2026-12-12T12:00:00Z',
    doorsOpenAt: '2026-12-12T10:00:00Z',
    saleOpensAt: '2026-11-14T03:00:00Z',
    waitingRoomOpensAt: '2026-11-14T02:30:00Z',
    saleEndsAt: '2026-11-20T16:59:59Z',
    state: 'on_sale',
    capacity: 12000,
    soldOutAt: null,
    imageUrl: 'https://cdn.rusuh.id/events/evt_2026_gbk/hero.jpg',
    eventCode: 'SMD'
  };
  const categories = [
    {
      categoryId: 'cat_vip',
      eventId: 'evt_2026_gbk',
      name: 'VIP',
      description: 'Duduk · depan panggung',
      seating: 'seated',
      entryGate: 'Gerbang 1',
      price: 3500000,
      total: 500,
      categoryCode: 'VIP'
    },
    {
      categoryId: 'cat_festival_b',
      eventId: 'evt_2026_gbk',
      name: 'Festival B',
      description: 'Berdiri · di belakang Festival A',
      seating: 'standing',
      entryGate: 'Gerbang 5',
      price: 1500000,
      total: 8000,
      categoryCode: 'FB'
    },
    {
      categoryId: 'cat_tribune',
      eventId: 'evt_2026_gbk',
      name: 'Tribun',
      description: 'Duduk · tribun atas',
      seating: 'seated',
      entryGate: 'Gerbang 9',
      price: 750000,
      total: 3500,
      categoryCode: 'TRB'
    }
  ];
  return { event, categories };
}

class MemoryStore {
  constructor(seed = true) {
    this.events = new Map();
    this.categories = new Map(); // eventId -> Map(categoryId -> category)
    this.bookings = new Map(); // bookingId -> booking
    this.tickets = new Map(); // ticketId -> ticket
    this.nikBackstop = new Map(); // `${eventId}:${nikHmac}` -> count
    this.categoryTicketSeq = new Map(); // `${eventId}:${categoryId}` -> lastValue
    this.emailLog = new Set(); // `${bookingId}:${type}`
    this.activeByAdmission = new Map(); // admissionToken -> bookingId
    this.activeByAccountEvent = new Map(); // `${accountId}:${eventId}` -> bookingId
    if (seed) {
      const { event, categories } = seedData();
      this.events.set(event.eventId, event);
      this.categories.set(event.eventId, new Map(categories.map((c) => [c.categoryId, c])));
    }
  }

  async listEvents() {
    return [...this.events.values()];
  }

  async getEvent(eventId) {
    return this.events.get(eventId) || null;
  }

  async getCategories(eventId) {
    const byEvent = this.categories.get(eventId);
    return byEvent ? [...byEvent.values()] : [];
  }

  async getCategory(eventId, categoryId) {
    return this.categories.get(eventId)?.get(categoryId) || null;
  }

  async createBooking(booking) {
    const stored = { ...booking, createdAt: nowIso(), updatedAt: nowIso() };
    this.bookings.set(stored.bookingId, stored);
    if (stored.status === 'SELECTION' || stored.status === 'PAYMENT_PENDING') {
      this.activeByAdmission.set(stored.admissionToken, stored.bookingId);
      this.activeByAccountEvent.set(`${stored.accountId}:${stored.eventId}`, stored.bookingId);
    }
    return { ...stored };
  }

  async getBooking(bookingId) {
    const booking = this.bookings.get(bookingId);
    return booking ? { ...booking } : null;
  }

  async getActiveBookingByAdmission(admissionToken) {
    const bookingId = this.activeByAdmission.get(admissionToken);
    if (!bookingId) return null;
    const booking = this.bookings.get(bookingId);
    if (!booking || (booking.status !== 'SELECTION' && booking.status !== 'PAYMENT_PENDING')) return null;
    return { ...booking };
  }

  async getActiveBookingByAccountEvent(accountId, eventId) {
    const bookingId = this.activeByAccountEvent.get(`${accountId}:${eventId}`);
    if (!bookingId) return null;
    const booking = this.bookings.get(bookingId);
    if (!booking || (booking.status !== 'SELECTION' && booking.status !== 'PAYMENT_PENDING')) return null;
    return { ...booking };
  }

  async getActiveBookingsByAccount(accountId) {
    return [...this.bookings.values()]
      .filter((b) => b.accountId === accountId && (b.status === 'SELECTION' || b.status === 'PAYMENT_PENDING'))
      .map((b) => ({ ...b }));
  }

  /**
   * Guarded status transition (UPDATE ... WHERE status = fromStatus).
   * Returns the updated booking, or null when the guard failed (0 rows).
   */
  async updateBookingStatus(bookingId, fromStatus, toStatus, patch = {}) {
    const booking = this.bookings.get(bookingId);
    if (!booking) return null;
    const from = Array.isArray(fromStatus) ? fromStatus : [fromStatus];
    if (!from.includes(booking.status)) return null;
    const updated = { ...booking, ...patch, status: toStatus, updatedAt: nowIso() };
    this.bookings.set(bookingId, updated);
    if (toStatus !== 'SELECTION' && toStatus !== 'PAYMENT_PENDING') {
      this.activeByAdmission.delete(updated.admissionToken);
      this.activeByAccountEvent.delete(`${updated.accountId}:${updated.eventId}`);
    }
    return { ...updated };
  }

  async updateBooking(bookingId, patch) {
    const booking = this.bookings.get(bookingId);
    if (!booking) return null;
    const updated = { ...booking, ...patch, updatedAt: nowIso() };
    this.bookings.set(bookingId, updated);
    return { ...updated };
  }

  async mintTickets(booking, ticketRows) {
    // Rows carry a pre-assigned sequence (from nextTicketSeq) + ticketCode + qrPayload.
    const minted = ticketRows.map((row) => {
      const ticket = {
        ticketId: row.ticketId,
        ticketCode: row.ticketCode,
        bookingId: booking.bookingId,
        eventId: booking.eventId,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        seating: row.seating,
        entryGate: row.entryGate,
        holderName: row.holderName,
        nikMasked: row.nikMasked,
        qrPayload: row.qrPayload,
        issuedAt: nowIso(),
        sequence: row.sequence
      };
      this.tickets.set(ticket.ticketId, ticket);
      return { ...ticket };
    });
    return minted;
  }

  async listTicketsByAccount(accountId) {
    const bookingIds = new Set(
      [...this.bookings.values()]
        .filter((b) => b.accountId === accountId && b.status === 'PAID')
        .map((b) => b.bookingId)
    );
    return [...this.tickets.values()].filter((t) => bookingIds.has(t.bookingId)).map((t) => ({ ...t }));
  }

  async getTicket(ticketId) {
    const ticket = this.tickets.get(ticketId);
    return ticket ? { ...ticket } : null;
  }

  async nikSeatCount(eventId, nikHmac) {
    return this.nikBackstop.get(`${eventId}:${nikHmac}`) || 0;
  }

  async incrementNikBackstop(eventId, nikHmac, delta) {
    const key = `${eventId}:${nikHmac}`;
    const next = (this.nikBackstop.get(key) || 0) + delta;
    if (next <= 0) this.nikBackstop.delete(key);
    else this.nikBackstop.set(key, next);
    return next;
  }

  async nextTicketSeq(eventId, categoryId) {
    const key = `${eventId}:${categoryId}`;
    const next = (this.categoryTicketSeq.get(key) || 0) + 1;
    this.categoryTicketSeq.set(key, next);
    return next;
  }

  /** Email dedup: returns false when (bookingId, type) was already logged. */
  async logEmail(bookingId, type) {
    const key = `${bookingId}:${type}`;
    if (this.emailLog.has(key)) return false;
    this.emailLog.add(key);
    return true;
  }

  async listDueBookings(nowIsoString, limit = 100) {
    const now = new Date(nowIsoString).getTime();
    return [...this.bookings.values()]
      .filter((b) => {
        if (b.status === 'SELECTION') return b.expiresAt && new Date(b.expiresAt).getTime() < now;
        if (b.status === 'PAYMENT_PENDING') return b.paymentExpiresAt && new Date(b.paymentExpiresAt).getTime() < now;
        return false;
      })
      .slice(0, limit)
      .map((b) => ({ ...b }));
  }

  async close() {
    // No resources to release.
  }
}

/**
 * Postgres store (D10). Same interface as MemoryStore. Requires the schema
 * in schema.sql (run once at deploy). Used only when DATABASE_URL is set.
 */
class PgStore {
  constructor(pool) {
    this.pool = pool;
  }

  static async connect(connectionString) {
    const pool = new Pool({ connectionString, max: 10 });
    await pool.query('SELECT 1');
    return new PgStore(pool);
  }

  async listEvents() {
    const { rows } = await this.pool.query(
      'SELECT event_id AS "eventId", name, subtitle, format, venue, venue_short AS "venueShort", city, timezone, starts_at AS "startsAt", doors_open_at AS "doorsOpenAt", sale_opens_at AS "saleOpensAt", waiting_room_opens_at AS "waitingRoomOpensAt", sale_ends_at AS "saleEndsAt", state, capacity, sold_out_at AS "soldOutAt", image_url AS "imageUrl", event_code AS "eventCode" FROM events ORDER BY starts_at'
    );
    return rows;
  }

  async getEvent(eventId) {
    const { rows } = await this.pool.query(
      'SELECT event_id AS "eventId", name, subtitle, format, venue, venue_short AS "venueShort", city, timezone, starts_at AS "startsAt", doors_open_at AS "doorsOpenAt", sale_opens_at AS "saleOpensAt", waiting_room_opens_at AS "waitingRoomOpensAt", sale_ends_at AS "saleEndsAt", state, capacity, sold_out_at AS "soldOutAt", image_url AS "imageUrl", event_code AS "eventCode" FROM events WHERE event_id = $1',
      [eventId]
    );
    return rows[0] || null;
  }

  async getCategories(eventId) {
    const { rows } = await this.pool.query(
      'SELECT category_id AS "categoryId", event_id AS "eventId", name, description, seating, entry_gate AS "entryGate", price, total, category_code AS "categoryCode" FROM categories WHERE event_id = $1 ORDER BY price',
      [eventId]
    );
    return rows;
  }

  async getCategory(eventId, categoryId) {
    const { rows } = await this.pool.query(
      'SELECT category_id AS "categoryId", event_id AS "eventId", name, description, seating, entry_gate AS "entryGate", price, total, category_code AS "categoryCode" FROM categories WHERE event_id = $1 AND category_id = $2',
      [eventId, categoryId]
    );
    return rows[0] || null;
  }

  async createBooking(booking) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO bookings (booking_id, event_id, account_id, admission_token, slot_id, status, expires_at, payment_expires_at, order_code, price, attendees, snap_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          booking.bookingId,
          booking.eventId,
          booking.accountId,
          booking.admissionToken,
          booking.slotId,
          booking.status,
          booking.expiresAt,
          booking.paymentExpiresAt || null,
          booking.orderCode,
          JSON.stringify(booking.price),
          JSON.stringify(booking.attendees),
          booking.snapToken || null
        ]
      );
      await client.query('COMMIT');
      return this._rowToBooking(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBooking(bookingId) {
    const { rows } = await this.pool.query('SELECT * FROM bookings WHERE booking_id = $1', [bookingId]);
    return rows[0] ? this._rowToBooking(rows[0]) : null;
  }

  async getActiveBookingByAdmission(admissionToken) {
    const { rows } = await this.pool.query(
      "SELECT * FROM bookings WHERE admission_token = $1 AND status IN ('SELECTION','PAYMENT_PENDING') ORDER BY created_at DESC LIMIT 1",
      [admissionToken]
    );
    return rows[0] ? this._rowToBooking(rows[0]) : null;
  }

  async getActiveBookingByAccountEvent(accountId, eventId) {
    const { rows } = await this.pool.query(
      "SELECT * FROM bookings WHERE account_id = $1 AND event_id = $2 AND status IN ('SELECTION','PAYMENT_PENDING') ORDER BY created_at DESC LIMIT 1",
      [accountId, eventId]
    );
    return rows[0] ? this._rowToBooking(rows[0]) : null;
  }

  async getActiveBookingsByAccount(accountId) {
    const { rows } = await this.pool.query(
      "SELECT * FROM bookings WHERE account_id = $1 AND status IN ('SELECTION','PAYMENT_PENDING') ORDER BY created_at DESC",
      [accountId]
    );
    return rows.map((row) => this._rowToBooking(row));
  }

  async updateBookingStatus(bookingId, fromStatus, toStatus, patch = {}) {
    const from = Array.isArray(fromStatus) ? fromStatus : [fromStatus];
    const sets = ['status = $2', 'updated_at = NOW()'];
    const values = [bookingId, toStatus];
    let idx = 3;
    if (patch.paymentExpiresAt !== undefined) {
      sets.push(`payment_expires_at = $${idx}`);
      values.push(patch.paymentExpiresAt);
      idx += 1;
    }
    if (patch.snapToken !== undefined) {
      sets.push(`snap_token = $${idx}`);
      values.push(patch.snapToken);
      idx += 1;
    }
    if (patch.paidAt !== undefined) {
      sets.push(`paid_at = $${idx}`);
      values.push(patch.paidAt);
      idx += 1;
    }
    if (patch.paymentMethod !== undefined) {
      sets.push(`payment_method = $${idx}`);
      values.push(patch.paymentMethod);
      idx += 1;
    }
    if (patch.refundRequired !== undefined) {
      sets.push(`refund_required = $${idx}`);
      values.push(patch.refundRequired);
      idx += 1;
    }
    if (patch.tickets !== undefined) {
      sets.push(`tickets = $${idx}`);
      values.push(JSON.stringify(patch.tickets));
      idx += 1;
    }
    const { rows } = await this.pool.query(
      `UPDATE bookings SET ${sets.join(', ')} WHERE booking_id = $1 AND status = ANY($${idx}) RETURNING *`,
      [...values, from]
    );
    return rows[0] ? this._rowToBooking(rows[0]) : null;
  }

  async updateBooking(bookingId, patch) {
    const sets = ['updated_at = NOW()'];
    const values = [bookingId];
    let idx = 2;
    Object.entries(patch).forEach(([key, value]) => {
      const column = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      sets.push(`${column} = $${idx}`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
      idx += 1;
    });
    const { rows } = await this.pool.query(
      `UPDATE bookings SET ${sets.join(', ')} WHERE booking_id = $1 RETURNING *`,
      values
    );
    return rows[0] ? this._rowToBooking(rows[0]) : null;
  }

  async mintTickets(booking, ticketRows) {
    // Rows carry a pre-assigned sequence (from nextTicketSeq) + ticketCode + qrPayload.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Sequential inserts inside one transaction (the pg client cannot run
      // concurrent queries); reduce keeps the order without await-in-loop.
      const minted = await ticketRows.reduce(async (prevPromise, row) => {
        const acc = await prevPromise;
        const { rows } = await client.query(
          `INSERT INTO tickets (ticket_id, ticket_code, booking_id, event_id, category_id, category_name, seating, entry_gate, holder_name, nik_masked, qr_payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            row.ticketId,
            row.ticketCode,
            booking.bookingId,
            booking.eventId,
            row.categoryId,
            row.categoryName,
            row.seating,
            row.entryGate,
            row.holderName,
            row.nikMasked,
            row.qrPayload
          ]
        );
        acc.push(this._rowToTicket(rows[0]));
        return acc;
      }, Promise.resolve([]));
      await client.query('COMMIT');
      return minted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listTicketsByAccount(accountId) {
    const { rows } = await this.pool.query(
      `SELECT t.* FROM tickets t JOIN bookings b ON b.booking_id = t.booking_id
       WHERE b.account_id = $1 AND b.status = 'PAID' ORDER BY t.issued_at`,
      [accountId]
    );
    return rows.map((row) => this._rowToTicket(row));
  }

  async getTicket(ticketId) {
    const { rows } = await this.pool.query('SELECT * FROM tickets WHERE ticket_id = $1', [ticketId]);
    return rows[0] ? this._rowToTicket(rows[0]) : null;
  }

  async nikSeatCount(eventId, nikHmac) {
    const { rows } = await this.pool.query('SELECT count FROM nik_backstop WHERE event_id = $1 AND nik_hmac = $2', [
      eventId,
      nikHmac
    ]);
    return rows[0] ? Number(rows[0].count) : 0;
  }

  async incrementNikBackstop(eventId, nikHmac, delta) {
    const { rows } = await this.pool.query(
      `INSERT INTO nik_backstop (event_id, nik_hmac, count) VALUES ($1,$2,$3)
       ON CONFLICT (event_id, nik_hmac) DO UPDATE SET count = nik_backstop.count + $3
       RETURNING count`,
      [eventId, nikHmac, delta]
    );
    const count = Number(rows[0].count);
    if (count <= 0)
      await this.pool.query('DELETE FROM nik_backstop WHERE event_id = $1 AND nik_hmac = $2', [eventId, nikHmac]);
    return Math.max(count, 0);
  }

  async nextTicketSeq(eventId, categoryId) {
    const { rows } = await this.pool.query(
      `INSERT INTO category_ticket_seq (event_id, category_id, last_value) VALUES ($1,$2,1)
       ON CONFLICT (event_id, category_id) DO UPDATE SET last_value = category_ticket_seq.last_value + 1
       RETURNING last_value`,
      [eventId, categoryId]
    );
    return Number(rows[0].last_value);
  }

  async logEmail(bookingId, type) {
    const { rowCount } = await this.pool.query(
      'INSERT INTO email_log (booking_id, type) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [bookingId, type]
    );
    return rowCount === 1;
  }

  async listDueBookings(nowIsoString, limit = 100) {
    const { rows } = await this.pool.query(
      `SELECT * FROM bookings WHERE
         (status = 'SELECTION' AND expires_at < $1) OR
         (status = 'PAYMENT_PENDING' AND payment_expires_at < $1)
       ORDER BY expires_at LIMIT $2`,
      [nowIsoString, limit]
    );
    return rows.map((row) => this._rowToBooking(row));
  }

  async close() {
    await this.pool.end();
  }

  _rowToBooking(row) {
    return {
      bookingId: row.booking_id,
      eventId: row.event_id,
      accountId: row.account_id,
      admissionToken: row.admission_token,
      slotId: row.slot_id,
      status: row.status,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      paymentExpiresAt: row.payment_expires_at ? new Date(row.payment_expires_at).toISOString() : null,
      orderCode: row.order_code,
      price: typeof row.price === 'string' ? JSON.parse(row.price) : row.price,
      attendees: typeof row.attendees === 'string' ? JSON.parse(row.attendees) : row.attendees,
      tickets: typeof row.tickets === 'string' ? JSON.parse(row.tickets) : row.tickets || [],
      snapToken: row.snap_token || null,
      paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
      paymentMethod: row.payment_method || null,
      refundRequired: Boolean(row.refund_required),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : nowIso(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : nowIso()
    };
  }

  _rowToTicket(row) {
    return {
      ticketId: row.ticket_id,
      ticketCode: row.ticket_code,
      bookingId: row.booking_id,
      eventId: row.event_id,
      categoryId: row.category_id,
      categoryName: row.category_name,
      seating: row.seating,
      entryGate: row.entry_gate,
      holderName: row.holder_name,
      nikMasked: row.nik_masked,
      qrPayload: row.qr_payload,
      issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : nowIso()
    };
  }
}

module.exports = { MemoryStore, PgStore, seedData };
