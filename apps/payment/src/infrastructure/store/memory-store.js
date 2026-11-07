/**
 * In-memory payment store (dev/test). Implements the same interface as the
 * Postgres store (postgres-store.js) so services run without a live database.
 * Production uses the Postgres store (PAYMENT_STORE=postgres + DATABASE_URL).
 *
 * payment_orders: one row per Snap ATTEMPT (key order_id).
 * payment_attempts: one row per Midtrans transaction_id (UNIQUE).
 * callback_log: one row per received webhook (including invalid signature).
 */

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function createMemoryStore() {
  const orders = new Map();
  const attempts = new Map();
  const callbackLogs = [];
  let attemptSeq = 0;
  let logSeq = 0;

  return {
    async createPaymentOrder({ orderId, bookingId, attempt, grossAmount, snapStartTime }) {
      if (orders.has(orderId)) {
        const error = new Error(`payment_orders order_id already exists: ${orderId}`);
        error.code = 'DUPLICATE_ORDER_ID';
        throw error;
      }
      const now = new Date();
      const order = {
        orderId,
        bookingId,
        attempt,
        grossAmount,
        status: 'created',
        snapStartTime: snapStartTime instanceof Date ? snapStartTime : new Date(snapStartTime),
        paymentType: null,
        createdAt: now,
        updatedAt: now
      };
      orders.set(orderId, order);
      return clone(order);
    },

    async getPaymentOrdersByBooking(bookingId) {
      return [...orders.values()]
        .filter((order) => order.bookingId === bookingId)
        .sort((a, b) => a.attempt - b.attempt)
        .map((order) => clone(order));
    },

    async getPaymentOrder(orderId) {
      const order = orders.get(orderId);
      return order ? clone(order) : null;
    },

    async updatePaymentOrder(orderId, patch) {
      const order = orders.get(orderId);
      if (!order) return null;
      if (patch.status !== undefined) order.status = patch.status;
      if (patch.paymentType !== undefined) order.paymentType = patch.paymentType;
      order.updatedAt = new Date();
      return clone(order);
    },

    async findPaymentAttempt(transactionId) {
      const attempt = attempts.get(transactionId);
      return attempt ? clone(attempt) : null;
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
      if (attempts.has(transactionId)) {
        const error = new Error(`payment_attempts transaction_id already exists: ${transactionId}`);
        error.code = 'DUPLICATE_TRANSACTION_ID';
        throw error;
      }
      const now = new Date();
      const attempt = {
        id: String((attemptSeq += 1)),
        orderId,
        bookingId,
        transactionId,
        transactionStatus,
        paymentType: paymentType || null,
        grossAmount: grossAmount === undefined ? null : grossAmount,
        confirmed: Boolean(confirmed),
        rawPayload: rawPayload === undefined ? null : clone(rawPayload),
        receivedAt: now,
        updatedAt: now
      };
      attempts.set(transactionId, attempt);
      return clone(attempt);
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
      const existing = attempts.get(transactionId);
      if (!existing) {
        return this.createPaymentAttempt({
          orderId,
          bookingId,
          transactionId,
          transactionStatus,
          paymentType,
          grossAmount,
          confirmed,
          rawPayload
        });
      }
      existing.transactionStatus = transactionStatus;
      if (paymentType !== undefined) existing.paymentType = paymentType;
      if (grossAmount !== undefined) existing.grossAmount = grossAmount;
      if (confirmed !== undefined) existing.confirmed = confirmed;
      if (rawPayload !== undefined) existing.rawPayload = clone(rawPayload);
      existing.updatedAt = new Date();
      return clone(existing);
    },

    async createCallbackLog({ orderId, bookingId, signatureValid, transactionStatus }) {
      const log = {
        id: String((logSeq += 1)),
        orderId: orderId || null,
        bookingId: bookingId || null,
        signatureValid: Boolean(signatureValid),
        transactionStatus: transactionStatus || null,
        receivedAt: new Date()
      };
      callbackLogs.push(log);
      return clone(log);
    },

    async getCallbackLogs({ orderId } = {}) {
      return callbackLogs.filter((log) => !orderId || log.orderId === orderId).map((log) => clone(log));
    }
  };
}

module.exports = { createMemoryStore };
