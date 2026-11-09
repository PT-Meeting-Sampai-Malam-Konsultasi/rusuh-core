/**
 * Port interfaces (Hexagonal / Onion): the contracts the application layer
 * depends on. Each port is the full adapter surface the use cases call;
 * the concrete adapters in infrastructure/ implement them (Memory + real
 * variants behind one interface). Use cases receive the adapters as
 * constructor arguments (dependency injection) and never require()
 * infrastructure files — see scripts/check-boundaries.js.
 *
 * The typedefs are documentation (JSDoc): there is no runtime code here.
 */

/**
 * Durable store port: bookings, tickets, events, categories, NIK backstop,
 * email dedup. Implemented by MemoryStore / PgStore
 * (infrastructure/persistence/store.js).
 *
 * @typedef {object} StorePort
 * @property {Function} listEvents - () => Promise<event[]>.
 * @property {Function} getEvent - (eventId) => Promise<event|null>.
 * @property {Function} getCategories - (eventId) => Promise<category[]>.
 * @property {Function} getCategory - (eventId, categoryId) => Promise<category|null>.
 * @property {Function} createBooking - (booking) => Promise<booking>.
 * @property {Function} getBooking - (bookingId) => Promise<booking|null>.
 * @property {Function} getActiveBookingByAdmission - (admissionToken) => Promise<booking|null>.
 * @property {Function} getActiveBookingByAccountEvent - (accountId, eventId) => Promise<booking|null>.
 * @property {Function} getActiveBookingsByAccount - (accountId) => Promise<booking[]>.
 * @property {Function} updateBookingStatus - (bookingId, fromStatus, toStatus, patch) => Promise<booking|null>.
 * @property {Function} updateBooking - (bookingId, patch) => Promise<booking>.
 * @property {Function} mintTickets - (booking, ticketRows) => Promise<ticket[]>.
 * @property {Function} listTicketsByAccount - (accountId) => Promise<ticket[]>.
 * @property {Function} getTicket - (ticketId) => Promise<ticket|null>.
 * @property {Function} nikSeatCount - (eventId, nikHmac) => Promise<number>.
 * @property {Function} incrementNikBackstop - (eventId, nikHmac, delta) => Promise<void>.
 * @property {Function} nextTicketSeq - (eventId, categoryId) => Promise<number>.
 * @property {Function} logEmail - (bookingId, type) => Promise<boolean> (dedup claim).
 * @property {Function} listDueBookings - (nowIsoString, limit) => Promise<booking[]>.
 * @property {Function} close - () => Promise<void>.
 */

/**
 * Live stock port: Valkey check-and-hold (Lua), admission entries, NIK
 * counters, validated-NIK set, token denylist. Implemented by MemoryStock /
 * RedisStock (infrastructure/cache/stock.js). Lua never receives a raw NIK —
 * only the HMAC blind index (D24).
 *
 * @typedef {object} StockPort
 * @property {Function} getAvailable - (eventId, categoryId) => Promise<number>.
 * @property {Function} getNikCount - (eventId, nikHmac) => Promise<number>.
 * @property {Function} checkAndHold - (eventId, items) => Promise<{ok: boolean, code?: string, categoryId?: string, nikHmac?: string}>.
 * @property {Function} release - (eventId, items) => Promise<void>.
 * @property {Function} settle - (eventId, items) => Promise<void>.
 * @property {Function} setAdmission - (token, entry, ttlMs) => Promise<void>.
 * @property {Function} getAdmission - (token) => Promise<object|null>.
 * @property {Function} addValidatedNik - (token, nikHmac) => Promise<void>.
 * @property {Function} getValidatedNiks - (token) => Promise<string[]>.
 * @property {Function} isDenied - (jti) => Promise<boolean>.
 * @property {Function} close - () => Promise<void>.
 */

/**
 * Dukcapil verification port: format-only verdict.
 * Implemented by DukcapilClient (infrastructure/external/dukcapil.js).
 * A negative verdict BLOCKS the purchase (gating, 6 Nov item 4).
 *
 * @typedef {object} DukcapilPort
 * @property {Function} verify - (nik) => Promise<{valid: boolean, reason: string|null}>.
 */

/**
 * Payment-module internal client port. Implemented by PaymentClient
 * (infrastructure/external/payment.js). Stub mode (no PAYMENT_URL) returns
 * a fake snap token and "pending" status.
 *
 * @typedef {object} PaymentPort
 * @property {boolean} isStub - True when no payment-module URL is configured.
 * @property {Function} createSnap - ({bookingId, attempt, orderId, grossAmount, itemDetails}) => Promise<{orderId, snapToken, redirectUrl}>.
 * @property {Function} getStatus - (orderId) => Promise<{status, grossAmount, transactionId, paymentType}|null>.
 * @property {Function} expire - (orderId) => Promise<void>.
 */

/**
 * Event bus port: empty-slot events (core -> queue) and email jobs
 * (core -> notification-module). Implemented by MemoryEventBus / SqsEventBus
 * (infrastructure/messaging/events.js).
 *
 * @typedef {object} EventBusPort
 * @property {Function} publishEmptySlot - ({event_id, released, released_ids, reason}) => Promise<object>.
 * @property {Function} sendEmailJob - ({booking_id, type, to, payload}) => Promise<object>.
 */
