const { Pool } = require('pg');
const { createMemoryStore } = require('./memory-store');

/**
 * Postgres payment store (production). Same interface as the memory store.
 * Tables: payment_orders, payment_attempts, callback_log (schema.sql).
 * The pool is created by the caller (or from DATABASE_URL) and closed by the
 * app on shutdown; tests inject a memory store instead.
 */

function mapOrder(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    bookingId: row.booking_id,
    attempt: row.attempt,
    grossAmount: row.gross_amount,
    status: row.status,
    snapStartTime: row.snap_start_time,
    paymentType: row.payment_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAttempt(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    orderId: row.order_id,
    bookingId: row.booking_id,
    transactionId: row.transaction_id,
    transactionStatus: row.transaction_status,
    paymentType: row.payment_type,
    grossAmount: row.gross_amount,
    confirmed: row.confirmed,
    rawPayload: row.raw_payload,
    receivedAt: row.received_at,
    updatedAt: row.updated_at
  };
}

function createPostgresStore({ pool } = {}) {
  if (!pool) throw new Error('createPostgresStore requires a pg Pool');

  return {
    async createPaymentOrder({ orderId, bookingId, attempt, grossAmount, snapStartTime }) {
      const { rows } = await pool.query(
        `INSERT INTO payment_orders (order_id, booking_id, attempt, gross_amount, snap_start_time)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [orderId, bookingId, attempt, grossAmount, snapStartTime]
      );
      return mapOrder(rows[0]);
    },

    async getPaymentOrdersByBooking(bookingId) {
      const { rows } = await pool.query('SELECT * FROM payment_orders WHERE booking_id = $1 ORDER BY attempt ASC', [
        bookingId
      ]);
      return rows.map(mapOrder);
    },

    async getPaymentOrder(orderId) {
      const { rows } = await pool.query('SELECT * FROM payment_orders WHERE order_id = $1', [orderId]);
      return mapOrder(rows[0] || null);
    },

    async updatePaymentOrder(orderId, patch) {
      const { rows } = await pool.query(
        `UPDATE payment_orders
            SET status = COALESCE($2, status),
                payment_type = COALESCE($3, payment_type),
                updated_at = now()
          WHERE order_id = $1 RETURNING *`,
        [orderId, patch.status ?? null, patch.paymentType ?? null]
      );
      return mapOrder(rows[0] || null);
    },

    async findPaymentAttempt(transactionId) {
      const { rows } = await pool.query('SELECT * FROM payment_attempts WHERE transaction_id = $1', [transactionId]);
      return mapAttempt(rows[0] || null);
    },

    async createPaymentAttempt({
      orderId,
      bookingId,
      transactionId,
      transactionStatus,
      paymentType,
      grossAmount,
      confirmed,
      rawPayload
    }) {
      const { rows } = await pool.query(
        `INSERT INTO payment_attempts
           (order_id, booking_id, transaction_id, transaction_status, payment_type, gross_amount, confirmed, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          orderId,
          bookingId,
          transactionId,
          transactionStatus,
          paymentType || null,
          grossAmount ?? null,
          Boolean(confirmed),
          rawPayload ?? null
        ]
      );
      return mapAttempt(rows[0]);
    },

    async upsertPaymentAttempt({
      orderId,
      bookingId,
      transactionId,
      transactionStatus,
      paymentType,
      grossAmount,
      confirmed,
      rawPayload
    }) {
      const { rows } = await pool.query(
        `INSERT INTO payment_attempts
           (order_id, booking_id, transaction_id, transaction_status, payment_type, gross_amount, confirmed, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (transaction_id) DO UPDATE SET
           transaction_status = EXCLUDED.transaction_status,
           payment_type = EXCLUDED.payment_type,
           gross_amount = EXCLUDED.gross_amount,
           confirmed = EXCLUDED.confirmed,
           raw_payload = EXCLUDED.raw_payload,
           updated_at = now()
         RETURNING *`,
        [
          orderId,
          bookingId,
          transactionId,
          transactionStatus,
          paymentType || null,
          grossAmount ?? null,
          Boolean(confirmed),
          rawPayload ?? null
        ]
      );
      return mapAttempt(rows[0]);
    },

    async createCallbackLog({ orderId, bookingId, signatureValid, transactionStatus }) {
      const { rows } = await pool.query(
        `INSERT INTO callback_log (order_id, booking_id, signature_valid, transaction_status)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [orderId || null, bookingId || null, Boolean(signatureValid), transactionStatus || null]
      );
      return {
        id: String(rows[0].id),
        orderId: rows[0].order_id,
        bookingId: rows[0].booking_id,
        signatureValid: rows[0].signature_valid,
        transactionStatus: rows[0].transaction_status,
        receivedAt: rows[0].received_at
      };
    },

    async getCallbackLogs({ orderId } = {}) {
      const { rows } = await pool.query(
        orderId
          ? 'SELECT * FROM callback_log WHERE order_id = $1 ORDER BY received_at ASC'
          : 'SELECT * FROM callback_log ORDER BY received_at ASC',
        orderId ? [orderId] : []
      );
      return rows.map((row) => ({
        id: String(row.id),
        orderId: row.order_id,
        bookingId: row.booking_id,
        signatureValid: row.signature_valid,
        transactionStatus: row.transaction_status,
        receivedAt: row.received_at
      }));
    }
  };
}

/**
 * Creates a payment store from the environment.
 *
 * @param {object} options - Store options.
 * @param {string} [options.kind] - "memory" (default, no DATABASE_URL) or "postgres".
 * @param {string} [options.databaseUrl] - Postgres connection string.
 * @param {object} [options.pool] - Injected pg Pool (tests).
 * @returns {object} Store (memory or Postgres) plus a close() for the pool.
 */
function createStore({ kind = 'memory', databaseUrl, pool } = {}) {
  if (kind === 'postgres') {
    const activePool = pool || new Pool({ connectionString: databaseUrl });
    const store = createPostgresStore({ pool: activePool });
    return { ...store, close: () => activePool.end() };
  }
  const store = createMemoryStore();
  return { ...store, close: async () => {} };
}

module.exports = { createStore, createPostgresStore };
