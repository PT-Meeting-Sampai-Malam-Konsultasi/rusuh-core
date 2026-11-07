/**
 * Fee calculation (structure decided 1 Nov, LLD-05 §5.3).
 * total = subtotal + platform_fee + admin_fee + tax1 + tax2
 *   tax1 = PPN 11% x platform_fee
 *   tax2 = rate x base (base = platform_fee by default), shown only when > 0
 * admin_fee null means TBD (no official Midtrans tariff yet) and counts as 0.
 *
 * @param {number} subtotal - Ticket subtotal (IDR).
 * @param {object} fees - Fee config.
 * @returns {object} Fee breakdown (all integer IDR).
 */
function calculateFees(subtotal, fees) {
  const platformFee = fees.platform_fee || 0;
  const adminFee = fees.admin_fee || 0;
  const tax1 = Math.round(platformFee * (fees.tax1_rate ?? 0.11));
  const tax2Base = fees.tax2 && fees.tax2.base === 'subtotal' ? subtotal : platformFee;
  const tax2 = Math.round(tax2Base * ((fees.tax2 && fees.tax2.rate) || 0));
  return {
    subtotal,
    platform_fee: platformFee,
    admin_fee: adminFee,
    tax1,
    tax2,
    tax2_label: fees.tax2 ? fees.tax2.label : 'Pajak Lainnya',
    total: subtotal + platformFee + adminFee + tax1 + tax2
  };
}

/**
 * Admin fee-config service (LLD-05 §5.3). A fee change only applies to
 * NEW bookings (bookings that already have a server-side total are not
 * rewritten).
 *
 * @param {object} store - Store with getFees/updateFees.
 * @param {object} audit - Audit service.
 * @returns {object} Fee operations.
 */
function createFeesService(store, audit) {
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

module.exports = { createFeesService, calculateFees };
