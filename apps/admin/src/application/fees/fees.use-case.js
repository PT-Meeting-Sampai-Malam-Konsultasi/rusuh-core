const { calculateFees } = require('@/domain/fees');

/**
 * Admin fee-config use case (LLD-05 §5.3). A fee change only applies to
 * NEW bookings (bookings that already have a server-side total are not
 * rewritten).
 *
 * @param {import('@/domain/ports/store.port').AdminStore} store - Store with getFees/updateFees.
 * @param {object} audit - Audit use case.
 * @returns {object} Fee operations.
 */
function createFeesUseCase(store, audit) {
  return {
    async getFees() {
      return store.getFees();
    },

    async updateFees(patch, actor) {
      const before = await store.getFees();
      const fees = await store.updateFees(patch);
      await audit.record({ actor, action: 'FEE_CHANGED', details: { before, after: fees } });
      return fees;
    },

    calculateFees
  };
}

module.exports = { createFeesUseCase, calculateFees };
