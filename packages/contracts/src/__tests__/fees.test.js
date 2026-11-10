const { computeFeeBreakdown, DEFAULT_PLATFORM_FEE_IDR, DEFAULT_ADMIN_FEE_IDR } = require('../fees');

describe('fee kernel (LLD-02 §8)', () => {
  it('computes total = subtotal + platform + admin + tax1 + tax2 with documented defaults', () => {
    const result = computeFeeBreakdown({ subtotal: 1000000 });
    expect(result).toEqual({
      subtotal: 1000000,
      platformFee: 30000,
      adminFee: 0,
      tax1: 3300,
      tax2: 0,
      tax2Label: 'Pajak Lainnya',
      serviceFee: 30000,
      total: 1033300
    });
    expect(DEFAULT_PLATFORM_FEE_IDR).toBe(30000);
    expect(DEFAULT_ADMIN_FEE_IDR).toBe(0);
  });

  it('tax1 is PPN on the platform fee only (admin fee is not taxed)', () => {
    const result = computeFeeBreakdown({ subtotal: 500000, platformFee: 30000, adminFee: 5000, tax1Rate: 0.11 });
    expect(result.tax1).toBe(3300);
    expect(result.serviceFee).toBe(35000);
    expect(result.total).toBe(500000 + 35000 + 3300);
  });

  it('treats admin_fee null as the TBD marker (0), platform_fee null as the default', () => {
    const result = computeFeeBreakdown({ subtotal: 500000, platformFee: null, adminFee: null });
    expect(result.platformFee).toBe(30000);
    expect(result.adminFee).toBe(0);
  });

  it('computes tax2 on the chosen base and rounds half-up', () => {
    const onSubtotal = computeFeeBreakdown({
      subtotal: 100000,
      platformFee: 3333,
      tax2Rate: 0.1,
      tax2Base: 'subtotal'
    });
    expect(onSubtotal.tax2).toBe(10000);
    // PPN on 3333 = 366.63 -> 367
    expect(onSubtotal.tax1).toBe(367);

    const onPlatform = computeFeeBreakdown({
      subtotal: 100000,
      platformFee: 30000,
      tax2Rate: 0.1,
      tax2Base: 'platform_fee'
    });
    expect(onPlatform.tax2).toBe(3000);
  });

  it('defaults tax2_label when the config omits it', () => {
    const result = computeFeeBreakdown({ subtotal: 0, tax2Rate: 0.1, tax2Label: undefined });
    expect(result.tax2Label).toBe('Pajak Lainnya');
  });
});
