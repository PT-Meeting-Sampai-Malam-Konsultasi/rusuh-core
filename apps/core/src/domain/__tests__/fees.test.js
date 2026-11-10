const { computePrice } = require('@/domain/fees');

describe('fees (LLD-02 §8)', () => {
  const fees = { platformFee: 30000, adminFee: 15000, ppnRate: 0.11, tax2Rate: 0, tax2Base: 0 };

  it('computes a single ticket at the default fees', () => {
    const result = computePrice(
      [{ categoryId: 'cat_festival_b', name: 'Festival B', quantity: 1, unitPrice: 1500000 }],
      fees
    );
    // subtotal 1.500.000 + platform 30.000 + admin 15.000 + PPN 11% x 30.000 = 3.300
    expect(result.ticketSubtotal).toEqual({ amount: 1500000, currency: 'IDR' });
    expect(result.adminFee).toEqual({ amount: 45000, currency: 'IDR' });
    expect(result.tax).toEqual({ amount: 3300, currency: 'IDR' });
    expect(result.total).toEqual({ amount: 1548300, currency: 'IDR' });
    expect(result.feeBreakdown).toEqual({
      platformFee: { amount: 30000, currency: 'IDR' },
      adminFee: { amount: 15000, currency: 'IDR' },
      tax1: { amount: 3300, currency: 'IDR' },
      tax2: { amount: 0, currency: 'IDR' },
      tax2Label: null
    });
  });

  it('sums multiple categories and quantities', () => {
    const result = computePrice(
      [
        { categoryId: 'cat_vip', name: 'VIP', quantity: 1, unitPrice: 3500000 },
        { categoryId: 'cat_tribune', name: 'Tribun', quantity: 2, unitPrice: 750000 }
      ],
      fees
    );
    expect(result.ticketSubtotal.amount).toBe(5000000);
    expect(result.total.amount).toBe(5000000 + 30000 + 15000 + 3300);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1].lineTotal.amount).toBe(1500000);
  });

  it('adds tax2 when configured (on the ticket subtotal, base 1)', () => {
    const result = computePrice([{ categoryId: 'cat_tribune', name: 'Tribun', quantity: 1, unitPrice: 100000 }], {
      ...fees,
      tax2Rate: 0.1,
      tax2Base: 1
    });
    expect(result.feeBreakdown.tax2.amount).toBe(10000);
    expect(result.total.amount).toBe(100000 + 30000 + 15000 + 3300 + 10000);
  });

  it('computes tax2 on the platform fee when base is 2', () => {
    const result = computePrice([{ categoryId: 'cat_tribune', name: 'Tribun', quantity: 1, unitPrice: 100000 }], {
      ...fees,
      tax2Rate: 0.1,
      tax2Base: 2
    });
    // tax2 = 10% x 30.000 (platform fee) = 3.000
    expect(result.feeBreakdown.tax2.amount).toBe(3000);
    expect(result.total.amount).toBe(100000 + 30000 + 15000 + 3300 + 3000);
  });

  it('rounds half-up', () => {
    // PPN on a platform fee of 3333: 366.63 -> 367
    const result = computePrice([{ categoryId: 'cat_tribune', name: 'Tribun', quantity: 1, unitPrice: 1000 }], {
      ...fees,
      platformFee: 3333,
      adminFee: 0
    });
    expect(result.feeBreakdown.tax1.amount).toBe(367);
  });

  it('returns a zero breakdown for an empty line list', () => {
    const result = computePrice([], fees);
    expect(result.ticketSubtotal.amount).toBe(0);
    expect(result.total.amount).toBe(30000 + 15000 + 3300);
  });

  it('applies the shared kernel defaults when no fee config is given', () => {
    // Platform fee 30000 (Q21); admin fee 0 — TBD from the Midtrans tariff,
    // same kernel @rusuh/contracts the admin-module preview uses.
    const result = computePrice([{ categoryId: 'cat_tribune', name: 'Tribun', quantity: 1, unitPrice: 100000 }]);
    expect(result.feeBreakdown.platformFee.amount).toBe(30000);
    expect(result.feeBreakdown.adminFee.amount).toBe(0);
    expect(result.total.amount).toBe(100000 + 30000 + 3300);
  });
});
