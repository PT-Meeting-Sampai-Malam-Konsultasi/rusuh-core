const { saleDocument, feedTtlMs, isListed } = require('@/domain/queue-feed');

/**
 * Feeds the queue (shared-keys.md, D-1, D-2; booking.v1, D-5).
 *  sync: every few seconds, the sale and stock of every event between the
 *        opening of its waiting room and the end of its sale, then the list.
 *  stockChanged: a fresh stock snapshot right after a hold, release or settle.
 *  relay: the booking outbox to stream:booking.
 *
 * @param {object} deps
 * @param {object} deps.store - StorePort (listEvents, getEvent, getCategories, relayOutbox).
 * @param {object} deps.feed - QueueFeedPort (publishSale, publishStock, syncListing, appendBookingEvent).
 * @param {object} [deps.logger] - console-like.
 * @param {number} [deps.relayBatch] - Outbox rows per relay run.
 * @returns {object} Queue feed use case.
 */
function createQueueFeedUseCase({ store, feed, logger = console, relayBatch = 100 }) {
  async function publishStock(event, now) {
    const categories = await store.getCategories(event.eventId);
    return feed.publishStock(
      event.eventId,
      categories.map((category) => category.categoryId),
      feedTtlMs(event, now),
      now
    );
  }

  return {
    async sync(now = new Date()) {
      const events = (await store.listEvents()).filter((event) => isListed(event, now));
      const results = await Promise.allSettled(
        events.map(async (event) => {
          await feed.publishSale(saleDocument(event, now), feedTtlMs(event, now));
          await publishStock(event, now);
        })
      );
      // The list changes only when every listed event's documents are in place,
      // so a failure never lists an event without its sale or drops a live one.
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
      const listed = events.map((event) => event.eventId);
      const { added, removed } = await feed.syncListing(listed);
      return { listed, added, removed };
    },

    async stockChanged(eventId, now = new Date()) {
      try {
        const event = await store.getEvent(eventId);
        if (!isListed(event, now)) return false;
        await publishStock(event, now);
        return true;
      } catch (error) {
        // The next sync publishes it; a booking never fails over the snapshot (NFR-10).
        logger.error(`[core] queue stock snapshot for ${eventId} failed: ${error.message}`);
        return false;
      }
    },

    async relay() {
      return store.relayOutbox(relayBatch, (row) => feed.appendBookingEvent(row.type, row.payload));
    }
  };
}

module.exports = { createQueueFeedUseCase };
