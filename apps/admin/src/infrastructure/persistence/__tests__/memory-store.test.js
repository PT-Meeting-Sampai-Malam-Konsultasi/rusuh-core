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

  it('applies a seed fee override', async () => {
    const store = createMemoryStore({ fees: { platform_fee: 50000 } });
    const fees = await store.getFees();
    expect(fees.platform_fee).toBe(50000);
    expect(fees.admin_fee).toBeNull();
  });

  it('creates an event, generating ids and nulling unset fields', async () => {
    const store = createMemoryStore();
    const event = await store.createEvent({
      name: 'Minimal',
      venue: 'GBK',
      starts_at: '2026-12-01T12:00:00Z',
      doors_open_at: '2026-12-01T09:00:00Z',
      capacity: 50,
      event_code: 'MIN',
      categories: [{ name: 'General', price: 100000, total: 50, category_code: 'GEN' }]
    });
    expect(event.event_id).toMatch(/^evt_/);
    expect(event.state).toBe('draft');
    expect(event.cap).toBeNull();
    expect(event.infra_cap).toBeNull();
    expect(event.categories[0].category_id).toMatch(/^cat_/);
    expect(event.categories[0].gate).toBeNull();
    expect(event.categories[0].almost_sold_out_threshold).toBeNull();
  });

  it('creates an event keeping provided ids, cap and thresholds', async () => {
    const store = createMemoryStore();
    const event = await store.createEvent({
      event_id: 'evt_custom',
      name: 'Full',
      venue: 'GBK',
      starts_at: '2026-12-01T12:00:00Z',
      doors_open_at: '2026-12-01T09:00:00Z',
      capacity: 100,
      event_code: 'FUL',
      cap_tier: 1,
      cap: 100,
      infra_cap: 80,
      categories: [
        {
          category_id: 'cat_a',
          name: 'A',
          price: 100000,
          total: 100,
          gate: 'G1',
          category_code: 'AAA',
          almost_sold_out_threshold: 5
        }
      ]
    });
    expect(event.event_id).toBe('evt_custom');
    expect(event.cap).toBe(100);
    expect(event.infra_cap).toBe(80);
    expect(event.categories[0].category_id).toBe('cat_a');
    expect(event.categories[0].gate).toBe('G1');
    expect(event.categories[0].almost_sold_out_threshold).toBe(5);
  });

  it('returns null when updating an unknown event', async () => {
    const store = createMemoryStore();
    expect(await store.updateEvent('evt_nope', { cap: 1 })).toBeNull();
  });

  it('returns null for an unknown user id', async () => {
    const store = createMemoryStore();
    expect(await store.getUserById('acc_nope')).toBeNull();
  });

  it('filters audit entries by actor, event and booking', async () => {
    const store = createMemoryStore();
    await store.insertAudit({
      actor_account_id: 'acc_admin_01',
      actor_role: 'admin',
      action: 'CAP_CHANGED',
      event_id: 'evt_2026_gbk',
      booking_id: 'bk_1',
      details: {}
    });
    await store.insertAudit({
      actor_account_id: 'acc_officer_01',
      actor_role: 'officer',
      action: 'SCAN',
      event_id: 'evt_other',
      booking_id: 'bk_2',
      details: {}
    });
    const byActor = await store.listAudit({ actor: 'acc_officer_01' });
    expect(byActor.total).toBe(1);
    expect(byActor.data[0].action).toBe('SCAN');
    const byEvent = await store.listAudit({ eventId: 'evt_2026_gbk' });
    expect(byEvent.total).toBe(1);
    expect(byEvent.data[0].actor_account_id).toBe('acc_admin_01');
    const byBooking = await store.listAudit({ bookingId: 'bk_2' });
    expect(byBooking.total).toBe(1);
    const all = await store.listAudit({});
    expect(all.total).toBe(2);
  });
});
