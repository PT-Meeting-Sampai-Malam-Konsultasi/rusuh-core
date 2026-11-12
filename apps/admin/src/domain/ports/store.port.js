/**
 * Admin store port — the persistence contract the use cases depend on.
 * Implemented by infrastructure/persistence/memory-store.js (tests +
 * local development) and infrastructure/persistence/postgres-store.js
 * (Postgres when DATABASE_URL is set). Use cases receive an object
 * implementing this port; they never require() an infrastructure file.
 *
 * All methods are async and return cloned plain objects (snake_case,
 * the admin-module response shape — see openapi.yaml Admin tag).
 *
 * @typedef {object} AdminEvent
 * @property {string} event_id - Event id (core events.event_id).
 * @property {string} name - Event name.
 * @property {string|null} subtitle - Subtitle.
 * @property {string|null} format - Live | Tour | Festival | ...
 * @property {string} venue - Venue.
 * @property {string|null} venue_short - Short venue label.
 * @property {string|null} city - City.
 * @property {string} timezone - IANA zone, default Asia/Jakarta.
 * @property {string} starts_at - Start time (ISO 8601, UTC).
 * @property {string|null} doors_open_at - Doors-open time (ISO 8601).
 * @property {string|null} sale_opens_at - Sale opening (ISO 8601).
 * @property {string|null} waiting_room_opens_at - Waiting room opening (ISO 8601).
 * @property {string|null} sale_ends_at - Sale end (ISO 8601).
 * @property {string} state - draft | coming_soon | waiting_room_open | on_sale | almost_gone |
 *   temporarily_full | sold_out | ended. draft is admin-only: core never returns it publicly.
 * @property {number} capacity - Event capacity.
 * @property {string|null} image_url - Public CDN image URL (must start with ASSET_BASE_URL).
 * @property {string} event_code - Short code used in ticket codes (e.g. SMD).
 * @property {number|null} cap_tier - CAP tier (1 | 3 | 10) or null.
 * @property {number|null} cap - Chosen cap or null.
 * @property {number|null} infra_cap - Infra cap or null.
 * @property {Array<object>} categories - { category_id, name, description, seating, gate,
 *   price, total, category_code, almost_sold_out_threshold }.
 *
 * @typedef {object} AdminFees
 * @property {number} platform_fee - Platform fee (IDR).
 * @property {number|null} admin_fee - Admin fee (IDR); null = TBD, counts as 0.
 * @property {number} tax1_rate - PPN rate (0.11).
 * @property {object} tax2 - Second tax { rate, base, label }.
 *
 * @typedef {object} AdminBooking
 * @property {string} id - Booking id.
 * @property {string} event_id - Event id.
 * @property {string} status - Booking status.
 * @property {Array<object>} tickets - Tickets (NIK always masked).
 * @property {number} subtotal - Ticket subtotal (IDR).
 * @property {number} service_fee - Service fee (IDR).
 * @property {number} total - Total (IDR).
 *
 * @typedef {object} AdminUser
 * @property {string} id - Account id.
 * @property {string} email - Account email.
 * @property {string} role - customer | officer | admin.
 *
 * @typedef {object} AdminStore
 * @property {() => Promise<Array<AdminEvent>>} listEvents - All events.
 * @property {(id: string) => Promise<AdminEvent|null>} getEvent - Event by id.
 * @property {(data: object) => Promise<AdminEvent>} createEvent - Creates the event and its categories atomically (one transaction).
 * @property {(id: string, patch: object) => Promise<AdminEvent|null>} updateEvent - Patches an event.
 * @property {(eventId: string) => Promise<{total: number, held: number, sold: number, available: number}|null>} getEventStats - Slot stats (held = PAYMENT_PENDING tickets, sold = PAID tickets).
 * @property {() => Promise<AdminFees>} getFees - Current fee config.
 * @property {(patch: object) => Promise<AdminFees>} updateFees - Updates the fee config.
 * @property {(id: string) => Promise<AdminBooking|null>} getBooking - Booking by id (NIK masked).
 * @property {(eventId?: string) => Promise<Array<object>>} listRefundFlags - Refund flags (read-only, ADR-0009).
 * @property {(query: {role?: string, page?: number, limit?: number}) => Promise<{data: Array<AdminUser>, total: number}>} listUsers - Users, paginated.
 * @property {(id: string) => Promise<AdminUser|null>} getUserById - User by account id (role lookup).
 * @property {(entry: object) => Promise<object>} insertAudit - Writes one audit row.
 * @property {(query: object) => Promise<{data: Array<object>, total: number}>} listAudit - Audit rows, paginated.
 */

module.exports = {};
