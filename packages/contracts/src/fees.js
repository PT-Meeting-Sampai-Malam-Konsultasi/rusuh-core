/**
 * Fee computation kernel (LLD-02 §8, decided 1 Nov) — the single
 * implementation shared by core-module (server-side booking totals) and
 * admin-module (fee config preview), so the two can never disagree again.
 *
 *  total = subtotal + platform fee + admin fee + tax1 + tax2
 *    tax1 = PPN 11% x platform fee (admin fee is NOT taxed)
 *    tax2 = rate x base, default 0; base = 'platform_fee' | 'subtotal'
 *  All amounts are integer IDR; tax is rounded half-up.
 *
 * Defaults follow the LLD: platform fee Rp 30.000 (Q21); admin fee TBD from
 * the Midtrans merchant tariff and NOT invented — it counts as 0 until an
 * official number exists.
 */

const DEFAULT_PLATFORM_FEE_IDR = 30000;
const DEFAULT_ADMIN_FEE_IDR = 0;
const DEFAULT_TAX1_RATE = 0.11;
const DEFAULT_TAX2_RATE = 0;
const DEFAULT_TAX2_BASE = 'platform_fee';
const DEFAULT_TAX2_LABEL = 'Pajak Lainnya';

/**
 * Computes the canonical fee breakdown for one order.
 *
 * @param {object} input
 * @param {number} input.subtotal - Ticket subtotal (integer IDR).
 * @param {number} [input.platformFee] - Flat per transaction (default 30000).
 * @param {number} [input.adminFee] - Flat per transaction (default 0, TBD).
 * @param {number} [input.tax1Rate] - PPN rate on the platform fee (default 0.11).
 * @param {number} [input.tax2Rate] - Second-tax rate (default 0).
 * @param {string} [input.tax2Base] - 'platform_fee' | 'subtotal' (default 'platform_fee').
 * @param {string} [input.tax2Label] - Second-tax label (default 'Pajak Lainnya').
 * @returns {{subtotal: number, platformFee: number, adminFee: number, tax1: number,
 *   tax2: number, tax2Label: string, serviceFee: number, total: number}} Integer IDR amounts.
 */
function computeFeeBreakdown({ subtotal, platformFee, adminFee, tax1Rate, tax2Rate, tax2Base, tax2Label }) {
  // ?? (not ||) so a null admin_fee — the explicit TBD marker in the admin
  // fee config — falls back to the default instead of being kept as null.
  const safeSubtotal = subtotal || 0;
  const safePlatformFee = platformFee ?? DEFAULT_PLATFORM_FEE_IDR;
  const safeAdminFee = adminFee ?? DEFAULT_ADMIN_FEE_IDR;
  const tax1 = Math.round(safePlatformFee * (tax1Rate ?? DEFAULT_TAX1_RATE));
  const base = tax2Base === 'subtotal' ? safeSubtotal : safePlatformFee;
  const tax2 = Math.round(base * (tax2Rate ?? DEFAULT_TAX2_RATE));

  return {
    subtotal: safeSubtotal,
    platformFee: safePlatformFee,
    adminFee: safeAdminFee,
    tax1,
    tax2,
    tax2Label: tax2Label ?? DEFAULT_TAX2_LABEL,
    serviceFee: safePlatformFee + safeAdminFee,
    total: safeSubtotal + safePlatformFee + safeAdminFee + tax1 + tax2
  };
}

module.exports = {
  DEFAULT_PLATFORM_FEE_IDR,
  DEFAULT_ADMIN_FEE_IDR,
  DEFAULT_TAX1_RATE,
  DEFAULT_TAX2_RATE,
  DEFAULT_TAX2_BASE,
  DEFAULT_TAX2_LABEL,
  computeFeeBreakdown
};
