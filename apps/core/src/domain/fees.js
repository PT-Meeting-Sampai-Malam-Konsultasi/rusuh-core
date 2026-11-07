/**
 * Fee computation (LLD-02 §8, decided 1 Nov).
 *  total = Σ(price × qty) + platform fee + admin fee + tax1 + tax2
 *  tax1 = PPN 11% × platform fee (admin fee is NOT taxed).
 *  tax2 = config rate × base, default 0; shown only when > 0.
 * All amounts are integer IDR; tax is rounded half-up.
 *
 * Response mapping (openapi.yaml PriceBreakdown): the yaml has one `adminFee`
 * line and one optional `tax` line, so the platform fee + admin fee are
 * combined into `adminFee` ("Biaya layanan") and tax1 + tax2 into `tax`.
 * The full split is kept in `feeBreakdown` (internal, not in the yaml shape).
 * If the team wants the split exposed, the yaml needs a `platformFee` field
 * and separate tax1/tax2 — flagged in the module report.
 */

function money(amount) {
  return { amount, currency: 'IDR' };
}

function roundHalfUp(value) {
  return Math.round(value);
}

/**
 * Computes the price breakdown for an order.
 *
 * @param {Array<{categoryId: string, name: string, quantity: number, unitPrice: number}>} lines
 *   Ticket lines (unit price in IDR).
 * @param {object} fees - Fee config.
 * @param {number} fees.platformFee - Flat per transaction (default 30000).
 * @param {number} fees.adminFee - Flat per transaction (default 15000).
 * @param {number} [fees.ppnRate] - PPN rate on the platform fee (default 0.11).
 * @param {number} [fees.tax2Rate] - Second-tax rate (default 0).
 * @param {number} [fees.tax2Base] - Second-tax base: 0 = off, 1 = ticket subtotal, 2 = platform fee.
 * @param {string} [fees.tax2Label] - Second-tax label (default "Pajak Lainnya").
 * @returns {object} PriceBreakdown (yaml shape) + feeBreakdown (internal split).
 */
function computePrice(lines, fees) {
  const platformFee = fees.platformFee ?? 30000;
  const adminFee = fees.adminFee ?? 15000;
  const ppnRate = fees.ppnRate ?? 0.11;
  const tax2Rate = fees.tax2Rate ?? 0;
  const tax2Base = fees.tax2Base ?? 0;
  const tax2Label = fees.tax2Label ?? 'Pajak Lainnya';

  const pricedLines = lines.map((line) => ({
    categoryId: line.categoryId,
    name: line.name,
    quantity: line.quantity,
    unitPrice: money(line.unitPrice),
    lineTotal: money(line.unitPrice * line.quantity)
  }));
  const ticketSubtotal = pricedLines.reduce((sum, line) => sum + line.lineTotal.amount, 0);

  const tax1 = roundHalfUp(platformFee * ppnRate);
  const tax2Amount = tax2Rate > 0 ? roundHalfUp((tax2Base === 1 ? ticketSubtotal : platformFee) * tax2Rate) : 0;
  const tax = tax1 + tax2Amount;
  const serviceFee = platformFee + adminFee;
  const total = ticketSubtotal + serviceFee + tax;

  const breakdown = {
    lines: pricedLines,
    ticketSubtotal: money(ticketSubtotal),
    adminFee: money(serviceFee),
    total: money(total)
  };
  if (tax > 0) breakdown.tax = money(tax);

  return {
    ...breakdown,
    feeBreakdown: {
      platformFee: money(platformFee),
      adminFee: money(adminFee),
      tax1: money(tax1),
      tax2: money(tax2Amount),
      tax2Label: tax2Amount > 0 ? tax2Label : null
    }
  };
}

module.exports = { computePrice, money };
