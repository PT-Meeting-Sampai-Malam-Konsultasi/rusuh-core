const crypto = require('crypto');
const { Pool } = require('pg');

/**
 * Postgres store implementing the admin-module store interface.
 * Tables follow LLD-05 §3 (events, categories, bookings, tickets,
 * config, audit_log, users, refund_flags) — the same Postgres the
 * core-module owns (D18: one deployable, one database).
 *
 * NOTE: there is no live database in this environment, so this store is
 * implemented (SQL written against the LLD-05 schema) but NOT integration
 * tested here. The memory store is the default when DATABASE_URL is unset
 * and is what the tests exercise.
 *
 * @param {object} options - Pool options.
 * @param {string} options.connectionString - Postgres connection string.
 * @param {object} [options.pool] - Injected pool (tests).
 * @returns {object} Store.
 */
function createPostgresStore({ connectionString, pool } = {}) {
  const db = pool || new Pool({ connectionString, max: 5 });

  /** Maps core-schema rows to the admin response shape. */
  const toEvent = (row, categories) => ({
    event_id: row.event_id,
    name: row.name,
    subtitle: row.subtitle,
    format: row.format,
    venue: row.venue,
    venue_short: row.venue_short,
    city: row.city,
    timezone: row.timezone,
    starts_at: row.starts_at,
    doors_open_at: row.doors_open_at,
    sale_opens_at: row.sale_opens_at,
    waiting_room_opens_at: row.waiting_room_opens_at,
    sale_ends_at: row.sale_ends_at,
    state: row.state,
    capacity: row.capacity,
    image_url: row.image_url,
    event_code: row.event_code,
    cap_tier: row.cap_tier,
    cap: row.cap,
    infra_cap: row.infra_cap,
    categories: categories || [],
    created_at: row.created_at,
    updated_at: row.updated_at
  });

  /** Loads the core-schema categories for one event. */
  async function findCategories(executor, eventId) {
    const { rows } = await executor.query(
      `SELECT category_id, event_id, name, description, seating, entry_gate AS gate,
              price, total, category_code, almost_sold_out_threshold
       FROM categories WHERE event_id = $1 ORDER BY price`,
      [eventId]
    );
    return rows;
  }

  return {
    async listEvents() {
      const { rows } = await db.query('SELECT * FROM events ORDER BY starts_at DESC');
      return Promise.all(rows.map(async (row) => toEvent(row, await findCategories(db, row.event_id))));
    },

    async getEvent(eventId) {
      const { rows } = await db.query('SELECT * FROM events WHERE event_id = $1', [eventId]);
      if (rows.length === 0) return null;
      return toEvent(rows[0], await findCategories(db, eventId));
    },

    async createEvent(data) {
      const client = await db.connect();
      const eventId = data.event_id || `evt_${crypto.randomUUID().replace(/-/g, '')}`;
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO events (
             event_id, name, subtitle, format, venue, venue_short, city, timezone,
             starts_at, doors_open_at, sale_opens_at, waiting_room_opens_at, sale_ends_at,
             state, capacity, image_url, event_code, cap_tier, cap, infra_cap
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
           ) RETURNING *`,
          [
            eventId,
            data.name,
            data.subtitle || null,
            data.format || null,
            data.venue,
            data.venue_short || null,
            data.city || null,
            data.timezone,
            data.starts_at,
            data.doors_open_at || null,
            data.sale_opens_at || null,
            data.waiting_room_opens_at || null,
            data.sale_ends_at || null,
            data.state,
            data.capacity,
            data.image_url || null,
            data.event_code,
            data.cap_tier ?? null,
            data.cap ?? null,
            data.infra_cap ?? null
          ]
        );
        /* eslint-disable no-await-in-loop */
        for (let i = 0; i < data.categories.length; i += 1) {
          const category = data.categories[i];
          const categoryId = category.category_id || `cat_${crypto.randomUUID().replace(/-/g, '')}`;
          await client.query(
            `INSERT INTO categories (
               category_id, event_id, name, description, seating, entry_gate, price, total, category_code,
               almost_sold_out_threshold
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              categoryId,
              eventId,
              category.name,
              category.description || null,
              category.seating,
              category.gate || null,
              category.price,
              category.total,
              category.category_code,
              category.almost_sold_out_threshold ?? null
            ]
          );
        }
        /* eslint-enable no-await-in-loop */
        await client.query('COMMIT');
        return toEvent(rows[0], await findCategories(db, eventId));
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateEvent(eventId, patch) {
      const eventColumns = {
        name: 'name',
        subtitle: 'subtitle',
        format: 'format',
        venue: 'venue',
        venue_short: 'venue_short',
        city: 'city',
        timezone: 'timezone',
        starts_at: 'starts_at',
        doors_open_at: 'doors_open_at',
        sale_opens_at: 'sale_opens_at',
        waiting_room_opens_at: 'waiting_room_opens_at',
        sale_ends_at: 'sale_ends_at',
        state: 'state',
        capacity: 'capacity',
        image_url: 'image_url',
        event_code: 'event_code',
        cap_tier: 'cap_tier',
        cap: 'cap',
        infra_cap: 'infra_cap'
      };
      const sets = [];
      const values = [];
      Object.entries(patch).forEach(([key, value]) => {
        if (eventColumns[key]) {
          values.push(value || null);
          sets.push(`${eventColumns[key]} = $${values.length}`);
        }
      });
      if (sets.length === 0) return this.getEvent(eventId);
      values.push(eventId);
      const { rows } = await db.query(
        `UPDATE events SET ${sets.join(', ')}, updated_at = now() WHERE event_id = $${values.length} RETURNING *`,
        values
      );
      if (rows.length === 0) return null;
      return toEvent(rows[0], await findCategories(db, eventId));
    },

    async getEventStats(eventId) {
      const event = await this.getEvent(eventId);
      if (!event) return null;
      const total = event.categories.reduce((sum, category) => sum + category.total, 0);
      const { rows } = await db.query(
        `SELECT b.status, COUNT(t.id) AS tickets
         FROM bookings b JOIN tickets t ON t.booking_id = b.id
         WHERE b.event_id = $1 AND b.status IN ('PAYMENT_PENDING', 'PAID')
         GROUP BY b.status`,
        [eventId]
      );
      const counts = rows.reduce(
        (acc, row) => {
          if (row.status === 'PAYMENT_PENDING') acc.held = Number(row.tickets);
          if (row.status === 'PAID') acc.sold = Number(row.tickets);
          return acc;
        },
        { held: 0, sold: 0 }
      );
      return { total, held: counts.held, sold: counts.sold, available: total - counts.held - counts.sold };
    },

    async getFees() {
      const { rows } = await db.query("SELECT value FROM config WHERE key = 'fees'");
      if (rows.length === 0) {
        return {
          platform_fee: 30000,
          admin_fee: null,
          tax1_rate: 0.11,
          tax2: { rate: 0, base: 'platform_fee', label: 'Pajak Lainnya' }
        };
      }
      return rows[0].value;
    },

    async updateFees(patch) {
      const current = await this.getFees();
      const next = { ...current, ...patch, tax2: { ...current.tax2, ...(patch.tax2 || {}) } };
      await db.query(
        `INSERT INTO config (key, value) VALUES ('fees', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(next)]
      );
      return next;
    },

    async getBooking(id) {
      const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
      if (rows.length === 0) return null;
      const tickets = await db.query(
        'SELECT t.public_code AS ticket_id, t.category_id, c.name AS category_name, c.price, t.nik_masked FROM tickets t JOIN categories c ON c.id = t.category_id WHERE t.booking_id = $1',
        [id]
      );
      return { ...rows[0], tickets: tickets.rows };
    },

    async listRefundFlags(eventId) {
      const { rows } = eventId
        ? await db.query('SELECT * FROM refund_flags WHERE event_id = $1 ORDER BY flagged_at DESC', [eventId])
        : await db.query('SELECT * FROM refund_flags ORDER BY flagged_at DESC');
      return rows.map((row) => ({
        bookingId: row.booking_id,
        eventId: row.event_id,
        orderId: row.order_id,
        transactionId: row.transaction_id,
        paymentType: row.payment_type,
        amount: { amount: row.amount, currency: row.currency },
        reason: row.reason,
        customerEmailMasked: row.customer_email_masked,
        flaggedAt: row.flagged_at
      }));
    },

    async listUsers({ role, page = 1, limit = 20 } = {}) {
      const values = [];
      let where = '';
      if (role) {
        values.push(role);
        where = `WHERE role = $${values.length}`;
      }
      const total = await db.query(`SELECT COUNT(*) AS total FROM users ${where}`, values);
      values.push(limit, (page - 1) * limit);
      const { rows } = await db.query(
        `SELECT id, email, role, created_at FROM users ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );
      return { data: rows, total: Number(total.rows[0].total) };
    },

    async getUserById(id) {
      const { rows } = await db.query('SELECT id, email, role, created_at FROM users WHERE id = $1', [id]);
      return rows[0] || null;
    },

    async insertAudit(entry) {
      const { rows } = await db.query(
        `INSERT INTO audit_log (actor_account_id, actor_role, action, ticket_id, booking_id, event_id, nik_masked, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          entry.actor_account_id,
          entry.actor_role,
          entry.action,
          entry.ticket_id || null,
          entry.booking_id || null,
          entry.event_id || null,
          entry.nik_masked || null,
          JSON.stringify(entry.details || {})
        ]
      );
      return rows[0];
    },

    async listAudit({ actor, action, eventId, bookingId, page = 1, limit = 20 } = {}) {
      const conditions = [];
      const values = [];
      const add = (clause, value) => {
        values.push(value);
        conditions.push(`${clause} $${values.length}`);
      };
      if (actor) add('actor_account_id =', actor);
      if (action) add('action =', action);
      if (eventId) add('event_id =', eventId);
      if (bookingId) add('booking_id =', bookingId);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const total = await db.query(`SELECT COUNT(*) AS total FROM audit_log ${where}`, values);
      values.push(limit, (page - 1) * limit);
      const { rows } = await db.query(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );
      return { data: rows, total: Number(total.rows[0].total) };
    },

    async close() {
      await db.end();
    }
  };
}

module.exports = { createPostgresStore };
