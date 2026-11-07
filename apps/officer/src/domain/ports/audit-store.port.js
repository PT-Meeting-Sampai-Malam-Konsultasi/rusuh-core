/**
 * AuditStore port — the adapter interface the officer use cases depend on.
 *
 * The application layer depends only on this contract (dependency
 * inversion); the Postgres and in-memory adapters in
 * infrastructure/persistence/audit-store.js implement it. No runtime
 * code lives here: the typedefs below ARE the contract.
 *
 * The full NIK is NEVER written here — only the action + nikMasked
 * (the log records THAT a full NIK was viewed, not its value).
 *
 * @typedef {object} AuditEntry
 * @property {string} actorAccountId - Officer account id.
 * @property {string} actorRole - Actor role ('officer').
 * @property {string} action - NIK_REVEALED | TICKET_MARKED_USED | SCAN_REJECTED.
 * @property {string} [ticketId] - Ticket id.
 * @property {string} [bookingId] - Booking id.
 * @property {string} [eventId] - Event id.
 * @property {string} [nikMasked] - Masked NIK (3171 •••• •••• 0001).
 * @property {object} [details] - Action details (JSON).
 *
 * @typedef {object} AuditStore
 * @property {Function} insert - (entry: AuditEntry) => Promise<AuditEntry & {id: number|string, createdAt: string}>.
 * @property {Function} list - () => Promise<AuditEntry[]>.
 */
