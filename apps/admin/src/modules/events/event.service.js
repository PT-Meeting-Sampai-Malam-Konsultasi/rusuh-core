const { ApiError } = require('@/errors');
const { CAP_TIERS } = require('./event.validation');

/**
 * Effective CAP = min(chosen cap, infra cap) — CAP final v1 (1 Nov).
 * infra_cap is the load-test breaking point x 0.75. When infra_cap is
 * not set, the chosen cap is the effective cap.
 *
 * @param {number|null} cap - Chosen cap.
 * @param {number|null} infraCap - Infra cap.
 * @returns {number|null} Effective cap.
 */
function effectiveCap(cap, infraCap) {
  if (cap === null || cap === undefined) return null;
  if (infraCap === null || infraCap === undefined) return cap;
  return Math.min(cap, infraCap);
}

/**
 * Total stock of an event = sum of its category totals.
 *
 * @param {object} event - Event with categories.
 * @returns {number} Total stock.
 */
function totalStock(event) {
  return (event.categories || []).reduce((sum, category) => sum + category.total, 0);
}

/**
 * Admin event service (LLD-05 §5.1–§5.2). CAP lives in the event model
 * (Postgres), never in Valkey (model event, ADR-0022); core uses the
 * effective CAP to compute empty slots + publish empty-slot events.
 *
 * @param {object} store - Store (events, stats, audit).
 * @param {object} audit - Audit service.
 * @returns {object} Event operations.
 */
function createEventService(store, audit) {
  const capResponse = (event) => ({
    cap_tier: event.cap_tier,
    cap: event.cap,
    effective_cap: effectiveCap(event.cap, event.infra_cap),
    infra_cap: event.infra_cap
  });

  return {
    async listEvents() {
      return store.listEvents();
    },

    async getEvent(eventId) {
      const event = await store.getEvent(eventId);
      if (!event) throw new ApiError('NOT_FOUND', `Event ${eventId} not found`);
      return event;
    },

    async createEvent(data, actor) {
      const event = await store.createEvent(data);
      await audit.record({
        actor,
        action: 'EVENT_CREATED',
        eventId: event.id,
        details: { name: event.name, cap: event.cap, cap_tier: event.cap_tier }
      });
      return event;
    },

    async updateEvent(eventId, patch, actor) {
      const event = await store.getEvent(eventId);
      if (!event) throw new ApiError('NOT_FOUND', `Event ${eventId} not found`);
      // Guard (LLD-05 §5.1): price/total may only change while draft.
      // After on_sale only CAP, threshold, doors_open_at and gate may change.
      if (event.status !== 'draft' && patch.categories) {
        const priceOrTotalChanged = patch.categories.some((category, index) => {
          const existing = event.categories[index];
          return !existing || existing.price !== category.price || existing.total !== category.total;
        });
        if (priceOrTotalChanged) {
          throw new ApiError('VALIDATION_FAILED', 'Price/total of a category may only change while the event is draft');
        }
      }
      const updated = await store.updateEvent(eventId, patch);
      await audit.record({ actor, action: 'EVENT_UPDATED', eventId, details: { patch: Object.keys(patch) } });
      return updated;
    },

    async getCap(eventId) {
      const event = await store.getEvent(eventId);
      if (!event) throw new ApiError('NOT_FOUND', `Event ${eventId} not found`);
      const stats = await store.getEventStats(eventId);
      return { ...capResponse(event), slots: stats };
    },

    async updateCap(eventId, { cap, capTier }, actor) {
      const event = await store.getEvent(eventId);
      if (!event) throw new ApiError('NOT_FOUND', `Event ${eventId} not found`);
      // Tier shortcut (D7): a tier without an explicit cap computes the
      // suggestion (total stock x multiplier) and saves it as the cap.
      let nextCap = cap;
      const nextTier = capTier ?? event.cap_tier;
      if (nextCap === undefined && capTier !== undefined) {
        nextCap = totalStock(event) * CAP_TIERS[capTier];
      }
      if (nextCap === undefined) {
        throw new ApiError('VALIDATION_FAILED', 'cap or cap_tier is required');
      }
      if (nextCap < 0) throw new ApiError('VALIDATION_FAILED', 'cap must be >= 0');
      const updated = await store.updateEvent(eventId, { cap: nextCap, cap_tier: nextTier });
      await audit.record({
        actor,
        action: 'CAP_CHANGED',
        eventId,
        details: {
          old_cap: event.cap,
          new_cap: nextCap,
          old_cap_tier: event.cap_tier,
          new_cap_tier: nextTier,
          paused: nextCap === 0
        }
      });
      return capResponse(updated);
    },

    async getStats(eventId) {
      const event = await store.getEvent(eventId);
      if (!event) throw new ApiError('NOT_FOUND', `Event ${eventId} not found`);
      const stats = await store.getEventStats(eventId);
      return { event_id: event.id, ...capResponse(event), slots: stats };
    }
  };
}

module.exports = { createEventService, effectiveCap, totalStock };
