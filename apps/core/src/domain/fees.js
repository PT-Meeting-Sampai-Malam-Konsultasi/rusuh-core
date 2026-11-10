const { fees: feeKernel } = require('@rusuh/contracts');

/**
 * Price computation for core-module (LLD-02 §8). The arithmetic lives in
 * @rusuh/contracts (fee kernel, shared with admin-module); this module maps
 * the kernel result to the API shapes.
 *
 * Response mapping (openapi.yaml PriceBreakdown): the yaml has one `adminFee`
 * line and one optional `tax` line, so the platform fee + admin fee are
 * combined into `adminFee` ("Biaya layanan") and tax1 + tax2 into `tax`.
 * The full split is kept in `feeBreakdown` (internal, not in the yaml shape).
 * If the team wants the split exposed, the yaml needs a `platformFee` field
 * and separate tax1/tax2 — flagged in the module report.
 */

/**
 * Computes the price breakdown for an order.
 *
 * @param {Array<{categoryId: string, name: string, quantity: number, unitPrice: number}>} lines
 *   Ticket lines (unit price in IDR).
 * @param {object} fees - Fee config (LLD-02 §8; kernel defaults apply per field).
 * @param {number} [fees.platformFee] - Flat per transaction (default 30000, Q21).
 * @param {number} [fees.adminFee] - Flat per transaction (default 0, TBD from the Midtrans tariff).
 * @param {number} [fees.ppnRate] - PPN rate on the platform fee (default 0.11).
 * @param {number} [fees.tax2Rate] - Second-tax rate (default 0).
 * @param {number} [fees.tax2Base] - 1 = ticket subtotal, anything else = platform fee.
 * @param {string} [fees.tax2Label] - Second-tax label (default "Pajak Lainnya").
 * @returns {object} PriceBreakdown (yaml shape) + feeBreakdown (internal split).
 */
function computePrice(lines, fees = {}) {
  const pricedLines = lines.map((line) => ({
    categoryId: line.categoryId,
    name: line.name,
    quantity: line.quantity,
    unitPrice: { amount: line.unitPrice, currency: 'IDR' },
    lineTotal: { amount: line.unitPrice * line.quantity, currency: 'IDR' }
  }));
  const ticketSubtotal = pricedLines.reduce((sum, line) => sum + line.lineTotal.amount, 0);

  const breakdown = feeKernel.computeFeeBreakdown({
    subtotal: ticketSubtotal,
    platformFee: fees.platformFee,
    adminFee: fees.adminFee,
    tax1Rate: fees.ppnRate,
    tax2Rate: fees.tax2Rate,
    // Env keeps the numeric TAX2_BASE codes (0/1/2); the kernel speaks strings.
    tax2Base: fees.tax2Base === 1 ? 'subtotal' : 'platform_fee',
    tax2Label: fees.tax2Label
  });
  const tax = breakdown.tax1 + breakdown.tax2;

  const result = {
    lines: pricedLines,
    ticketSubtotal: { amount: ticketSubtotal, currency: 'IDR' },
    adminFee: { amount: breakdown.serviceFee, currency: 'IDR' }
  };
  if (tax > 0) result.tax = { amount: tax, currency: 'IDR' };
  result.total = { amount: breakdown.total, currency: 'IDR' };

  return {
    ...result,
    feeBreakdown: {
      platformFee: { amount: breakdown.platformFee, currency: 'IDR' },
      adminFee: { amount: breakdown.adminFee, currency: 'IDR' },
      tax1: { amount: breakdown.tax1, currency: 'IDR' },
      tax2: { amount: breakdown.tax2, currency: 'IDR' },
      tax2Label: breakdown.tax2 > 0 ? breakdown.tax2Label : null
    }
  };
}

module.exports = { computePrice };
