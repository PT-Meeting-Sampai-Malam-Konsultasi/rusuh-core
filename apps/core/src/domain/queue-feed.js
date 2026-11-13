const crypto = require('crypto');

/**
 * What core publishes for the queue (rusuh-documentation/api/shared-keys.md,
 * api/events/booking.v1.schema.json). The queue refuses anything that breaks
 * these rules, so they are checked here before anything is written.
 */

const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEVICE_ID = /^[wm]_[A-Za-z0-9_-]{16,32}$/;
const FEED_TTL_AFTER_END_MS = 24 * 60 * 60 * 1000;

const iso = (value) => (value ? new Date(value).toISOString() : null);

function saleWindow(event) {
  if (!event || event.state === 'draft' || !EVENT_ID.test(event.eventId || '')) return null;
  const saleOpensAt = iso(event.saleOpensAt);
  const endsAt = iso(event.saleEndsAt);
  if (!saleOpensAt || !endsAt || endsAt <= saleOpensAt) return null;
  const waitingRoomOpensAt = iso(event.waitingRoomOpensAt) || saleOpensAt;
  return { waitingRoomOpensAt, saleOpensAt, endsAt };
}

/** core:{evt}:sale, or null when the event cannot be sold through the queue. */
function saleDocument(event, now) {
  const window = saleWindow(event);
  if (!window) return null;
  return { v: 1, eventId: event.eventId, status: 'published', ...window, updatedAt: now.toISOString() };
}

/** TTL of the event's core:{evt}:* keys: a day past the end of the sale. */
function feedTtlMs(event, now) {
  return new Date(event.saleEndsAt).getTime() + FEED_TTL_AFTER_END_MS - now.getTime();
}

/** In core:events from the opening of the waiting room until the sale ends. */
function isListed(event, now) {
  const window = saleWindow(event);
  if (!window) return false;
  const at = now.getTime();
  return at >= Date.parse(window.waitingRoomOpensAt) && at < Date.parse(window.endsAt);
}

/**
 * The admission token's sub is the device. The token itself was proven by its
 * Valkey record (the queue registered it), so the payload is only read here.
 */
function deviceIdFromAdmissionToken(raw) {
  const parts = typeof raw === 'string' ? raw.split('.') : [];
  if (parts.length !== 3) return null;
  try {
    const { sub } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof sub === 'string' && DEVICE_ID.test(sub) ? sub : null;
  } catch (_error) {
    return null;
  }
}

/** The first booking field the queue could not key a booking.v1 event on, or null. */
function bookingEventGap(booking) {
  if (!EVENT_ID.test(booking.eventId || '')) return 'eventId';
  if (!booking.slotId) return 'slotId';
  if (!DEVICE_ID.test(booking.deviceId || '')) return 'deviceId';
  return null;
}

/** One booking.v1 payload, or null when the queue could not use it. */
function bookingEvent(type, booking, now) {
  if (bookingEventGap(booking)) return null;
  return {
    v: 1,
    id: crypto.randomUUID(),
    type,
    eventId: booking.eventId,
    slotId: booking.slotId,
    deviceId: booking.deviceId,
    bookingId: booking.bookingId,
    units: booking.attendees.length,
    ...(type === 'booking.held' ? { paymentDeadline: iso(booking.paymentExpiresAt) } : {}),
    occurredAt: now.toISOString()
  };
}

module.exports = {
  saleDocument,
  feedTtlMs,
  isListed,
  deviceIdFromAdmissionToken,
  bookingEvent,
  bookingEventGap,
  DEVICE_ID
};
