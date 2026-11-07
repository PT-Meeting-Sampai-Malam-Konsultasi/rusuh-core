const { createMemoryStore } = require('@/infrastructure/memory-store');
const { createAuditService } = require('@/modules/audit/audit.service');
const { createEventService, effectiveCap, totalStock } = require('@/modules/events/event.service');

const actor = { accountId: 'acc_admin_01', email: 'admin@rusuh.id', role: 'admin' };

describe('effectiveCap', () => {
  it('is min(chosen, infra)', () => {
    expect(effectiveCap(2000, 1500)).toBe(1500);
    expect(effectiveCap(1000, 1500)).toBe(1000);
    expect(effectiveCap(0, 1500)).toBe(0);
  });

  it('is the chosen cap when infra_cap is unset', () => {
    expect(effectiveCap(2000, null)).toBe(2000);
    expect(effectiveCap(2000, undefined)).toBe(2000);
  });

  it('is null when no cap is chosen', () => {
    expect(effectiveCap(null, 1500)).toBeNull();
  });
});

describe('totalStock', () => {
  it('sums category totals', () => {
    expect(totalStock({ categories: [{ total: 2000 }, { total: 200 }] })).toBe(2200);
  });
});

describe('createEventService', () => {
  let store;
  let service;

  beforeEach(() => {
    store = createMemoryStore();
    service = createEventService(store, createAuditService(store));
  });

  describe('getCap / getStats', () => {
    it('returns cap + slot stats from Postgres booking states (seeded)', async () => {
      const cap = await service.getCap('evt_2026_gbk');
      expect(cap.cap).toBe(2000);
      expect(cap.cap_tier).toBe(3);
      expect(cap.infra_cap).toBe(1500);
      expect(cap.effective_cap).toBe(1500);
      // seeded: total 2200 (2000 festival + 200 vip), held 3 (2 festival + 1 vip), sold 1
      expect(cap.slots).toEqual({ total: 2200, held: 3, sold: 1, available: 2196 });
    });

    it('throws NOT_FOUND for an unknown event', async () => {
      await expect(service.getCap('evt_nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(service.getStats('evt_nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('updateCap', () => {
    it('accepts cap=0 as PAUSE and audits CAP_CHANGED', async () => {
      const cap = await service.updateCap('evt_2026_gbk', { cap: 0 }, actor);
      expect(cap.cap).toBe(0);
      expect(cap.effective_cap).toBe(0);
      const { data } = await store.listAudit({ action: 'CAP_CHANGED' });
      expect(data).toHaveLength(1);
      expect(data[0].details).toMatchObject({ old_cap: 2000, new_cap: 0, paused: true });
    });

    it('computes the cap from a tier when no explicit cap is given', async () => {
      const cap = await service.updateCap('evt_2026_gbk', { capTier: 1 }, actor);
      // total stock 2200 x 1 = 2200, effective = min(2200, 1500) = 1500
      expect(cap.cap).toBe(2200);
      expect(cap.cap_tier).toBe(1);
      expect(cap.effective_cap).toBe(1500);
    });

    it('rejects a negative cap', async () => {
      await expect(service.updateCap('evt_2026_gbk', { cap: -1 }, actor)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED'
      });
    });

    it('requires cap or cap_tier', async () => {
      await expect(service.updateCap('evt_2026_gbk', {}, actor)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('throws NOT_FOUND for an unknown event', async () => {
      await expect(service.updateCap('evt_nope', { cap: 10 }, actor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('updateEvent draft guard', () => {
    it('rejects price/total changes after on_sale', async () => {
      await expect(
        service.updateEvent(
          'evt_2026_gbk',
          {
            categories: [{ name: 'Festival', price: 600000, total: 2000, gate: 'Gerbang 5' }]
          },
          actor
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('allows price/total changes while draft', async () => {
      const updated = await service.updateEvent(
        'evt_2026_draft',
        {
          categories: [{ name: 'General', price: 120000, total: 100, gate: 'Gerbang 1' }]
        },
        actor
      );
      expect(updated.categories[0].price).toBe(120000);
    });

    it('allows doors_open_at changes after on_sale', async () => {
      const updated = await service.updateEvent('evt_2026_gbk', { doors_open_at: '2026-11-14T17:00:00+07:00' }, actor);
      expect(updated.doors_open_at).toBe('2026-11-14T17:00:00+07:00');
    });
  });
});
