const { problemError } = require('@/lib/problem');
const { presentEvent, presentCategory, serverNow } = require('@/lib/presenters');

/**
 * Event catalogue (core.booking): public list/detail + the Detail page
 * categories (prices + live stock, admission-gated).
 *
 * @param {object} deps
 * @param {object} deps.store - Durable store (events, categories).
 * @param {object} deps.stock - Live stock adapter (available counts).
 * @param {object} deps.fees - Fee config ({ adminFee }).
 * @returns {object} Events service.
 */
function createEventsService({ store, stock, fees }) {
  return {
    async listEvents({ state } = {}) {
      const events = await store.listEvents();
      const filtered = state && state.length > 0 ? events.filter((e) => state.includes(e.state)) : events;
      const items = await Promise.all(
        filtered.map(async (event) => {
          const categories = await store.getCategories(event.eventId);
          const cheapest = categories.reduce((min, c) => (min === null || c.price < min ? c.price : min), null);
          return presentEvent({
            ...event,
            priceFrom: cheapest === null ? null : { amount: cheapest, currency: 'IDR' }
          });
        })
      );
      return { items, serverNow: serverNow() };
    },

    async getEvent(eventId) {
      const event = await store.getEvent(eventId);
      if (!event) throw problemError('NOT_FOUND', 'No such resource for this caller.');
      const categories = await store.getCategories(eventId);
      const cheapest = categories.reduce((min, c) => (min === null || c.price < min ? c.price : min), null);
      return presentEvent({ ...event, priceFrom: cheapest === null ? null : { amount: cheapest, currency: 'IDR' } });
    },

    /**
     * Detail Ticket page data (GET /v1/events/:id/categories).
     * Requires a live admission token (validated by the route middleware).
     * Stock is a snapshot at load; the hold re-checks it atomically.
     */
    async getCategories(eventId, admission) {
      const event = await store.getEvent(eventId);
      if (!event) throw problemError('NOT_FOUND', 'No such resource for this caller.');
      const categories = await store.getCategories(eventId);
      const presented = await Promise.all(
        categories.map(async (category) => {
          const available = await stock.getAvailable(eventId, category.categoryId);
          return presentCategory(category, available);
        })
      );
      // End of the 5-minute order window: the admission TTL ends 10 minutes
      // after the Detail window (60s claim + 5 min Detail + 10 min payment).
      const admissionExpiresAt = admission?.expiresAt
        ? new Date(admission.expiresAt).getTime()
        : Date.now() + 16 * 60 * 1000;
      const expiresAt = new Date(admissionExpiresAt - 10 * 60 * 1000).toISOString();
      return {
        eventId,
        categories: presented,
        maxTicketsPerOrder: 3,
        maxTickets: admission?.maxTickets || 3,
        adminFee: { amount: fees.adminFee, currency: 'IDR' },
        expiresAt,
        serverNow: serverNow()
      };
    }
  };
}

module.exports = { createEventsService };
