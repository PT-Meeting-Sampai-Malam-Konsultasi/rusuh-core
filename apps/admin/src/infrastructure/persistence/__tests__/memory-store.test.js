const { createMemoryStore } = require('@/infrastructure/persistence/memory-store');

describe('createMemoryStore', () => {
  it('computes slot stats from booking states (ticket units)', async () => {
    const store = createMemoryStore();
    const stats = await store.getEventStats('evt_2026_gbk');
    expect(stats).toEqual({ total: 2200, held: 3, sold: 1, available: 2196 });
  });

  it('returns null stats for an unknown event', async () => {
    const store = createMemoryStore();
    expect(await store.getEventStats('evt_nope')).toBeNull();
  });

  it('persists a CAP change', async () => {
    const store = createMemoryStore();
    const updated = await store.updateEvent('evt_2026_gbk', { cap: 0, cap_tier: 3 });
    expect(updated.cap).toBe(0);
    expect((await store.getEvent('evt_2026_gbk')).cap).toBe(0);
  });

  it('lists users with a role filter', async () => {
    const store = createMemoryStore();
    const { data, total } = await store.listUsers({ role: 'admin' });
    expect(total).toBe(1);
    expect(data[0].email).toBe('admin@rusuh.id');
  });

  it('records audit entries', async () => {
    const store = createMemoryStore();
    await store.insertAudit({
      actor_account_id: 'acc_admin_01',
      actor_role: 'admin',
      action: 'CAP_CHANGED',
      event_id: 'evt_2026_gbk',
      details: { old_cap: 2000, new_cap: 0 }
    });
    const { data, total } = await store.listAudit({ action: 'CAP_CHANGED' });
    expect(total).toBe(1);
    expect(data[0].details.new_cap).toBe(0);
  });
});
