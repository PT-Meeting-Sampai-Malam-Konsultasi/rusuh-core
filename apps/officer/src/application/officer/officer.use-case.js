const { apiError } = require('@/domain/errors');

/**
 * @typedef {import('@/domain/ports/ticket-store.port').TicketStore} TicketStore
 * @typedef {import('@/domain/ports/audit-store.port').AuditStore} AuditStore
 * @typedef {import('@/domain/nik').NikCrypto} NikCrypto
 */

/**
 * Today's date (YYYY-MM-DD) in Asia/Jakarta — event dates are Jakarta dates.
 *
 * @returns {string} YYYY-MM-DD.
 */
function todayInJakarta() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/**
 * Public ticket view (pre-scan): masked NIK only, never the full NIK.
 * Shape follows the openapi.yaml Ticket schema (qrPayload omitted: the
 * officer already holds the QR, and the signed payload is not returned).
 *
 * @param {object} ticket - Ticket record from the store.
 * @returns {object} Ticket view.
 */
function toTicketView(ticket) {
  return {
    ticketId: ticket.id,
    ticketCode: ticket.publicCode,
    bookingId: ticket.bookingId,
    eventId: ticket.eventId,
    eventName: ticket.eventName,
    categoryId: ticket.categoryId,
    categoryName: ticket.categoryName,
    seating: ticket.seating,
    entryGate: ticket.gate,
    holderName: ticket.holderName,
    nikMasked: ticket.nikMasked,
    status: ticket.status,
    usedAt: ticket.usedAt,
    usedBy: ticket.usedBy,
    issuedAt: ticket.issuedAt
  };
}

/**
 * Creates the officer use case (gate flow, LLD-05 §4).
 *
 * Flow (task brief): lookup shows the masked NIK; a successful scan reveals
 * the full NIK AND marks the ticket used (one step). This differs from the
 * LLD-05 two-step flow (reveal via POST /officer/scans, then mark-used) —
 * see README; the LLD's separate reveal endpoint is not implemented here.
 *
 * The adapters are injected (ports in domain/ports/); this file never
 * requires infrastructure.
 *
 * @param {object} deps
 * @param {TicketStore} deps.ticketStore - TicketStore (Postgres or in-memory).
 * @param {AuditStore} deps.auditStore - AuditStore (Postgres or in-memory).
 * @param {NikCrypto} deps.nikCrypto - { decrypt } (AES-256-GCM, D24).
 * @returns {object} { lookupTicket, scanTicket, listAttendees }
 */
function createOfficerUseCase({ ticketStore, auditStore, nikCrypto }) {
  if (!ticketStore || !auditStore || !nikCrypto) {
    throw new Error('createOfficerUseCase requires ticketStore, auditStore and nikCrypto');
  }

  const auditBase = (officerId, ticket) => ({
    actorAccountId: officerId,
    actorRole: 'officer',
    ticketId: ticket.id,
    bookingId: ticket.bookingId,
    eventId: ticket.eventId,
    nikMasked: ticket.nikMasked
  });

  return {
    /**
     * Lookup by ticket id or public code (QR). Pre-scan: masked NIK only.
     *
     * @param {string} codeOrId - Ticket id (tk_…) or public code (SMD-FB-04827).
     * @returns {Promise<object>} Ticket view.
     */
    async lookupTicket(codeOrId) {
      const ticket = await ticketStore.findByCodeOrId(codeOrId);
      if (!ticket) throw apiError('TICKET_NOT_FOUND', `Ticket ${codeOrId} was not found`);
      return toTicketView(ticket);
    },

    /**
     * Scan: reveal the full NIK and mark the ticket used (atomic, idempotent).
     * A repeat scan of an already-used ticket returns the SAME result (not an
     * error) and is still written to the audit log (SCAN_REJECTED, fraud signal).
     *
     * @param {string} codeOrId - Ticket id or public code.
     * @param {object} options
     * @param {string} options.officerId - Officer account id.
     * @param {string} [options.gate] - Gate where the scan happens.
     * @returns {Promise<object>} Scanned ticket view (with nikFull).
     */
    async scanTicket(codeOrId, { officerId, gate }) {
      const ticket = await ticketStore.findByCodeOrId(codeOrId);
      if (!ticket) throw apiError('TICKET_NOT_FOUND', `Ticket ${codeOrId} was not found`);

      if (ticket.eventDate && ticket.eventDate !== todayInJakarta()) {
        await auditStore.insert({
          ...auditBase(officerId, ticket),
          action: 'SCAN_REJECTED',
          details: { reason: 'not_valid_date', eventDate: ticket.eventDate }
        });
        throw apiError('TICKET_NOT_VALID', `Ticket is only valid on ${ticket.eventDate}`);
      }

      let nikFull;
      try {
        nikFull = await nikCrypto.decrypt(ticket.nikCipher);
      } catch (_error) {
        // LLD-05 §4.3: 503 + alert, no decrypt bypass.
        throw apiError('SERVICE_UNAVAILABLE', 'NIK decryption failed (KMS unavailable)');
      }

      const gateWarning =
        gate && ticket.gate && gate !== ticket.gate ? { expectedGate: ticket.gate, scannedAtGate: gate } : null;

      const result = await ticketStore.markUsed(codeOrId, { usedBy: officerId });
      if (!result) throw apiError('TICKET_NOT_FOUND', `Ticket ${codeOrId} was not found`);
      const updated = result.ticket;

      // Audit: the full NIK WAS revealed (record the fact + masked NIK, never the value).
      await auditStore.insert({ ...auditBase(officerId, updated), action: 'NIK_REVEALED', details: {} });
      if (result.alreadyUsed) {
        await auditStore.insert({
          ...auditBase(officerId, updated),
          action: 'SCAN_REJECTED',
          details: { reason: 'already_used', idempotent: true }
        });
      } else {
        await auditStore.insert({
          ...auditBase(officerId, updated),
          action: 'TICKET_MARKED_USED',
          details: { usedAt: updated.usedAt, ...(gateWarning ? { gateWarning } : {}) }
        });
      }

      return {
        ...toTicketView(updated),
        nikFull,
        ...(gateWarning ? { gateWarning } : {})
      };
    },

    /**
     * List attendees (tickets) for an event, masked NIK, paginated.
     *
     * @param {string} eventId - Event id.
     * @param {object} paging - { page, limit }.
     * @returns {Promise<object>} { data, meta: { total, page, limit } }.
     */
    async listAttendees(eventId, { page, limit }) {
      const event = await ticketStore.findEvent(eventId);
      if (!event) throw apiError('NOT_FOUND', `Event ${eventId} was not found`);
      const { items, total } = await ticketStore.listByEvent(eventId, { page, limit });
      return {
        data: items.map(toTicketView),
        meta: { total, page, limit }
      };
    }
  };
}

module.exports = { createOfficerUseCase, toTicketView, todayInJakarta };
