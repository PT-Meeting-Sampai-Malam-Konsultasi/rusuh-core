const { createMemoryStore } = require('@/infrastructure/persistence/memory-store');
const { createAuditUseCase } = require('@/application/audit/audit.use-case');
const { createFeesUseCase, calculateFees } = require('@/application/fees/fees.use-case');

const actor = { accountId: 'acc_admin_01', email: 'admin@rusuh.id', role: 'admin' };

describe('calculateFees', () => {
  it('total = subtotal + platform fee + admin fee + PPN 11% x platform fee', () => {
    const fees = {
      platform_fee: 30000,
      admin_fee: 5000,
      tax1_rate: 0.11,
      tax2: { rate: 0, base: 'platform_fee', label: 'Pajak Lainnya' }
    };
    const result = calculateFees(1000000, fees);
    expect(result).toEqual({
      subtotal: 1000000,
      platform_fee: 30000,
      admin_fee: 5000,
      tax1: 3300,
      tax2: 0,
      tax2_label: 'Pajak Lainnya',
      total: 1038300
    });
  });

  it('admin_fee null (TBD) counts as 0', () => {
    const fees = {
      platform_fee: 30000,
      admin_fee: null,
      tax1_rate: 0.11,
      tax2: { rate: 0, base: 'platform_fee', label: 'Pajak Lainnya' }
    };
    const result = calculateFees(500000, fees);
    expect(result.admin_fee).toBe(0);
    expect(result.total).toBe(500000 + 30000 + 3300);
  });

  it('tax2 is charged when its rate is > 0 and hidden (0) otherwise', () => {
    const fees = {
      platform_fee: 30000,
      admin_fee: null,
      tax1_rate: 0.11,
      tax2: { rate: 0.1, base: 'platform_fee', label: 'PBJT Hiburan' }
    };
    const result = calculateFees(500000, fees);
    expect(result.tax2).toBe(3000);
    expect(result.tax2_label).toBe('PBJT Hiburan');
  });
});

describe('createFeesUseCase', () => {
  let store;
  let service;

  beforeEach(() => {
    store = createMemoryStore();
    service = createFeesUseCase(store, createAuditUseCase(store));
  });

  it('returns the default fee config', async () => {
    const fees = await service.getFees();
    expect(fees.platform_fee).toBe(30000);
    expect(fees.admin_fee).toBeNull();
    expect(fees.tax1_rate).toBe(0.11);
    expect(fees.tax2).toEqual({ rate: 0, base: 'platform_fee', label: 'Pajak Lainnya' });
  });

  it('updates fees and audits FEE_CHANGED', async () => {
    const fees = await service.updateFees({ platform_fee: 25000 }, actor);
    expect(fees.platform_fee).toBe(25000);
    const { data } = await store.listAudit({ action: 'FEE_CHANGED' });
    expect(data).toHaveLength(1);
    expect(data[0].details.before.platform_fee).toBe(30000);
    expect(data[0].details.after.platform_fee).toBe(25000);
  });
});
