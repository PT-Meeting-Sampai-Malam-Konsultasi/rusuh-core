/**
 * TicketStore port — the adapter interface the officer use cases depend on.
 *
 * The application layer depends only on this contract (dependency
 * inversion); the Postgres and in-memory adapters in
 * infrastructure/persistence/ticket-store.js implement it. No runtime
 * code lives here: the typedefs below ARE the contract.
 *
 * @typedef {object} Ticket
 * @property {string} id - Internal ticket id (tk_…).
 * @property {string} publicCode - Public ticket code (SMD-FB-04827).
 * @property {string} bookingId - Booking id.
 * @property {string} eventId - Event id.
 * @property {string|null} eventName - Event name.
 * @property {string|null} eventDate - Event date (YYYY-MM-DD, Asia/Jakarta).
 * @property {string} categoryId - Category id.
 * @property {string} categoryName - Category name.
 * @property {string|null} gate - Entry gate.
 * @property {string|null} seating - Seating info.
 * @property {string} holderName - Ticket holder name.
 * @property {string} nikMasked - Masked NIK (3171 •••• •••• 0001).
 * @property {string} nikCipher - AES-256-GCM ciphertext of the full NIK.
 * @property {string} status - 'unused' | 'used'.
 * @property {string|null} usedAt - ISO timestamp of the scan.
 * @property {string|null} usedBy - Officer account id that scanned.
 * @property {string} issuedAt - ISO timestamp of issue.
 *
 * @typedef {object} TicketStore
 * @property {Function} findByCodeOrId - (codeOrId: string) => Promise<Ticket|null>.
 * @property {Function} findEvent - (eventId: string) => Promise<{id: string, name: string, date: string}|null>.
 * @property {Function} markUsed - (codeOrId: string, { usedBy: string }) => Promise<{ticket: Ticket, alreadyUsed: boolean}|null>. Atomic check-and-mark (UPDATE … WHERE status='unused'); null when the ticket does not exist; alreadyUsed=true on a repeat scan (idempotent, not an error).
 * @property {Function} listByEvent - (eventId: string, { page: number, limit: number }) => Promise<{items: Ticket[], total: number}>.
 */
