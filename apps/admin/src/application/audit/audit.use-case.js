/**
 * Audit log writer (LLD-05 §3.2). Every sensitive admin action is written
 * here AND to the operational log (Q40). Full NIK is NEVER written —
 * only nik_masked, and only the fact that a full NIK was viewed.
 *
 * @param {object} store - Store with insertAudit.
 * @returns {object} { record(entry) }.
 */
function createAuditService(store) {
  return {
    async record({ actor, action, ticketId, bookingId, eventId, nikMasked, details }) {
      return store.insertAudit({
        actor_account_id: actor.accountId,
        actor_role: actor.role,
        action,
        ticket_id: ticketId || null,
        booking_id: bookingId || null,
        event_id: eventId || null,
        nik_masked: nikMasked || null,
        details: details || {}
      });
    }
  };
}

module.exports = { createAuditService };
