const crypto = require('crypto');

/**
 * In-memory store implementing the admin-module store interface.
 * Used for tests and for local development without a database.
 * The Postgres store (postgres-store.js) implements the same interface.
 *
 * Seeded with one on-sale event, one draft event, a few bookings
 * (held / sold / expired) and one refund flag so CAP/stats endpoints
 * have data to work with out of the box.
 */
function createMemoryStore(seed = {}) {
  const now = new Date().toISOString();
  const events = new Map();
  const bookings = new Map();
  const refundFlags = [];
  const auditLog = [];
  const users = new Map();
  let fees = {
    platform_fee: 30000,
    admin_fee: null,
    tax1_rate: 0.11,
    tax2: { rate: 0, base: 'platform_fee', label: 'Pajak Lainnya' }
  };

  const seedEvent = (overrides = {}) => {
    const id = overrides.id || `evt_${crypto.randomUUID().slice(0, 8)}`;
    const event = {
      id,
      name: 'Samudra',
      venue: 'GBK',
      date: '2026-11-14',
      doors_open_at: '2026-11-14T16:00:00+07:00',
      status: 'on_sale',
      cap_tier: 3,
      cap: 2000,
      infra_cap: 1500,
      categories: [
        {
          id: 'cat_festival',
          name: 'Festival',
          price: 500000,
          total: 2000,
          gate: 'Gerbang 5',
          almost_sold_out_threshold: 100
        },
        { id: 'cat_vip', name: 'VIP', price: 1500000, total: 200, gate: 'Gerbang 1', almost_sold_out_threshold: 20 }
      ],
      created_at: now,
      updated_at: now,
      ...overrides
    };
    events.set(id, event);
    return event;
  };

  const seedBooking = (overrides = {}) => {
    const id = overrides.id || `bk_${crypto.randomUUID().slice(0, 8)}`;
    const booking = {
      id,
      event_id: 'evt_2026_gbk',
      status: 'PAYMENT_PENDING',
      tickets: [
        {
          ticket_id: null,
          category_id: 'cat_festival',
          category_name: 'Festival',
          price: 500000,
          nik_masked: '3171****0001'
        }
      ],
      subtotal: 500000,
      service_fee: 30000,
      total: 533300,
      expires_at: '2026-11-14T10:56:00+07:00',
      payment_expires_at: '2026-11-14T10:55:00+07:00',
      created_at: now,
      ...overrides
    };
    bookings.set(id, booking);
    return booking;
  };

  seedEvent({ id: 'evt_2026_gbk', name: 'Samudra', venue: 'GBK' });
  seedEvent({
    id: 'evt_2026_draft',
    name: 'Draft Event',
    venue: 'GBK',
    status: 'draft',
    cap: 100,
    infra_cap: 100,
    categories: [
      { id: 'cat_draft', name: 'General', price: 100000, total: 100, gate: 'Gerbang 1', almost_sold_out_threshold: 10 }
    ]
  });
  seedBooking({
    id: 'bk_held_1',
    status: 'PAYMENT_PENDING',
    tickets: [
      {
        ticket_id: null,
        category_id: 'cat_festival',
        category_name: 'Festival',
        price: 500000,
        nik_masked: '3171****0001'
      },
      {
        ticket_id: null,
        category_id: 'cat_festival',
        category_name: 'Festival',
        price: 500000,
        nik_masked: '3171****0002'
      }
    ]
  });
  seedBooking({
    id: 'bk_held_2',
    status: 'PAYMENT_PENDING',
    tickets: [
      { ticket_id: null, category_id: 'cat_vip', category_name: 'VIP', price: 1500000, nik_masked: '3171****0003' }
    ]
  });
  seedBooking({
    id: 'bk_sold_1',
    status: 'PAID',
    tickets: [
      {
        ticket_id: 'SMD-FB-00001',
        category_id: 'cat_festival',
        category_name: 'Festival',
        price: 500000,
        nik_masked: '3171****0004'
      }
    ]
  });
  seedBooking({
    id: 'bk_expired_1',
    status: 'EXPIRED',
    tickets: [
      {
        ticket_id: null,
        category_id: 'cat_festival',
        category_name: 'Festival',
        price: 500000,
        nik_masked: '3171****0005'
      }
    ]
  });
  refundFlags.push({
    bookingId: 'bk_paid_late_1',
    eventId: 'evt_2026_gbk',
    orderId: 'bk_paid_late_1-2',
    transactionId: '7b1f3c2e-5d4a-4e8b-9c61-2f0a8d3e1b57',
    paymentType: 'qris',
    amount: { amount: 1515000, currency: 'IDR' },
    reason: 'paid_after_expiry',
    customerEmailMasked: 'ad***@example.com',
    flaggedAt: '2026-11-14T11:05:00Z'
  });
  [
    { id: 'acc_admin_01', email: 'admin@rusuh.id', role: 'admin', created_at: now },
    { id: 'acc_officer_01', email: 'officer@rusuh.id', role: 'officer', created_at: now },
    { id: 'acc_customer_01', email: 'customer@example.id', role: 'customer', created_at: now }
  ].forEach((user) => users.set(user.id, user));
  if (seed.fees) fees = { ...fees, ...seed.fees };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  return {
    async listEvents() {
      return [...events.values()].map(clone);
    },

    async getEvent(id) {
      const event = events.get(id);
      return event ? clone(event) : null;
    },

    async createEvent(data) {
      const id = data.id || `evt_${crypto.randomUUID().slice(0, 8)}`;
      const event = {
        id,
        name: data.name,
        venue: data.venue,
        date: data.date,
        doors_open_at: data.doors_open_at,
        status: 'draft',
        cap_tier: data.cap_tier ?? null,
        cap: data.cap ?? null,
        infra_cap: data.infra_cap ?? null,
        categories: (data.categories || []).map((category) => ({
          id: category.id || `cat_${crypto.randomUUID().slice(0, 8)}`,
          name: category.name,
          price: category.price,
          total: category.total,
          gate: category.gate || null,
          almost_sold_out_threshold: category.almost_sold_out_threshold ?? null
        })),
        created_at: now,
        updated_at: new Date().toISOString()
      };
      events.set(id, event);
      return clone(event);
    },

    async updateEvent(id, patch) {
      const event = events.get(id);
      if (!event) return null;
      const updated = { ...event, ...patch, updated_at: new Date().toISOString() };
      events.set(id, updated);
      return clone(updated);
    },

    async getEventStats(eventId) {
      const event = events.get(eventId);
      if (!event) return null;
      const total = event.categories.reduce((sum, category) => sum + category.total, 0);
      const counts = [...bookings.values()]
        .filter((booking) => booking.event_id === eventId)
        .reduce(
          (acc, booking) => {
            if (booking.status === 'PAYMENT_PENDING') acc.held += booking.tickets.length;
            if (booking.status === 'PAID') acc.sold += booking.tickets.length;
            return acc;
          },
          { held: 0, sold: 0 }
        );
      return { total, held: counts.held, sold: counts.sold, available: total - counts.held - counts.sold };
    },

    async getFees() {
      return clone(fees);
    },

    async updateFees(patch) {
      fees = { ...fees, ...patch, tax2: { ...fees.tax2, ...(patch.tax2 || {}) } };
      return clone(fees);
    },

    async getBooking(id) {
      const booking = bookings.get(id);
      return booking ? clone(booking) : null;
    },

    async listRefundFlags(eventId) {
      const flags = eventId ? refundFlags.filter((flag) => flag.eventId === eventId) : refundFlags;
      return flags.map(clone);
    },

    async listUsers({ role, page = 1, limit = 20 } = {}) {
      const all = [...users.values()].filter((user) => !role || user.role === role);
      const start = (page - 1) * limit;
      return { data: all.slice(start, start + limit).map(clone), total: all.length };
    },

    async getUserById(id) {
      const user = users.get(id);
      return user ? clone(user) : null;
    },

    async insertAudit(entry) {
      const row = { id: `aud_${crypto.randomUUID().slice(0, 8)}`, created_at: new Date().toISOString(), ...entry };
      auditLog.push(row);
      return clone(row);
    },

    async listAudit({ actor, action, eventId, bookingId, page = 1, limit = 20 } = {}) {
      const all = auditLog.filter(
        (row) =>
          (!actor || row.actor_account_id === actor) &&
          (!action || row.action === action) &&
          (!eventId || row.event_id === eventId) &&
          (!bookingId || row.booking_id === bookingId)
      );
      const start = (page - 1) * limit;
      return { data: all.slice(start, start + limit).map(clone), total: all.length };
    }
  };
}

module.exports = { createMemoryStore };
