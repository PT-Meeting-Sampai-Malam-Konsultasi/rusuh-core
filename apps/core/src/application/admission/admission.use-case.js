/**
 * Creates the admission use case (registerAdmission, synchronous; ADR-0027).
 * The queue calls POST /v1/core/admission and core stores the entry in
 * Valkey BEFORE the token is handed to the user, so the async SQS race
 * (token not yet consumed when the user opens Detail) cannot happen.
 * This replaces the SQS admission event (ADR-0021/0023).
 *
 * @param {object} options
 * @param {object} options.stock - Stock adapter (setAdmission).
 * @param {number} [options.ttlMs] - Admission entry TTL cap (default 16 min).
 * @returns {object} Admission use case.
 */
function createAdmissionUseCase({ stock, ttlMs = 16 * 60 * 1000 } = {}) {
  if (!stock) throw new Error('createAdmissionUseCase requires stock');
  return {
    /**
     * Stores one admission entry (idempotent: storing the same token twice
     * overwrites it with the same entry). The stored TTL is the time until
     * expires_at, capped at ttlMs (same rule the old AdmissionConsumer used).
     *
     * @param {object} admission - { admission_token, user_id, event_id, slot_id, max_tickets, expires_at }.
     * @returns {Promise<{stored: boolean}>}
     */
    async registerAdmission(admission) {
      const entry = {
        user_id: admission.user_id,
        event_id: admission.event_id,
        slot_id: admission.slot_id || null,
        device_id: admission.device_id || null,
        max_tickets: admission.max_tickets || 3,
        expires_at: admission.expires_at || new Date(Date.now() + ttlMs).toISOString()
      };
      const ttl = Math.max(new Date(entry.expires_at).getTime() - Date.now(), 1000);
      await stock.setAdmission(admission.admission_token, entry, Math.min(ttl, ttlMs));
      return { stored: true };
    }
  };
}

module.exports = { createAdmissionUseCase };
