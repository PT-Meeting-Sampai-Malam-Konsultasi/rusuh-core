const { fees: feeKernel } = require('@rusuh/contracts');

/**
 * Fee calculation for admin-module (LLD-05 §5.3). Pure function — no I/O, no
 * framework, no infrastructure. The arithmetic lives in @rusuh/contracts
 * (fee kernel, shared with core-module) so an admin fee preview and a core
 * booking total can never disagree; this module only maps the admin fee
 * config shape (snake_case) to the kernel and back.
 *
 * admin_fee null means TBD (no official Midtrans tariff yet, LLD-02 §8) and
 * counts as 0; a missing platform_fee falls back to the kernel default
 * (Rp 30.000, Q21) — it is never silently zero.
 *
 * @param {number} subtotal - Ticket subtotal (IDR).
 * @param {object} fees - Fee config ({platform_fee, admin_fee, tax1_rate, tax2}).
 * @returns {object} Fee breakdown (all integer IDR).
 */
function calculateFees(subtotal, fees = {}) {
  const breakdown = feeKernel.computeFeeBreakdown({
    subtotal,
    platformFee: fees.platform_fee,
    adminFee: fees.admin_fee,
    tax1Rate: fees.tax1_rate,
    tax2Rate: fees.tax2 ? fees.tax2.rate : undefined,
    tax2Base: fees.tax2 ? fees.tax2.base : undefined,
    tax2Label: fees.tax2 ? fees.tax2.label : undefined
  });
  return {
    subtotal: breakdown.subtotal,
    platform_fee: breakdown.platformFee,
    admin_fee: breakdown.adminFee,
    tax1: breakdown.tax1,
    tax2: breakdown.tax2,
    tax2_label: breakdown.tax2Label,
    total: breakdown.total
  };
}

module.exports = { calculateFees };
