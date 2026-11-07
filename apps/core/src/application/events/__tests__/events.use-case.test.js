const { MemoryStore } = require('@/infrastructure/persistence/store');
const { MemoryStock } = require('@/infrastructure/cache/stock');
const { createEventsUseCase } = require('@/application/events/events.use-case');

const FEES = { adminFee: 15000 };

function buildUseCase() {
  const store = new MemoryStore();
  const stock = new MemoryStock();
  return { store, stock, useCase: createEventsUseCase({ store, stock, fees: FEES }) };
}

describe('events use case (catalogue)', () => {
  it('listEvents returns all events with the cheapest price, and filters by state', async () => {
    const { useCase } = buildUseCase();
    const all = await useCase.listEvents();
    expect(all.items).toHaveLength(1);
    expect(all.items[0]).toMatchObject({ eventId: 'evt_2026_gbk', priceFrom: { amount: 750000, currency: 'IDR' } });
    expect(all.serverNow).toBeDefined();

    const onSale = await useCase.listEvents({ state: ['on_sale'] });
    expect(onSale.items).toHaveLength(1);
    const closed = await useCase.listEvents({ state: ['closed'] });
    expect(closed.items).toHaveLength(0);
    const emptyState = await useCase.listEvents({ state: [] });
    expect(emptyState.items).toHaveLength(1);
  });

  it('listEvents returns a null priceFrom when an event has no categories', async () => {
    const { store, useCase } = buildUseCase();
    // Remove the categories for the seeded event.
    store.categories.clear();
    const all = await useCase.listEvents();
    expect(all.items[0].priceFrom).toBeNull();
  });

  it('getEvent returns the event with the cheapest price, or 404', async () => {
    const { useCase } = buildUseCase();
    const event = await useCase.getEvent('evt_2026_gbk');
    expect(event).toMatchObject({ eventId: 'evt_2026_gbk', priceFrom: { amount: 750000, currency: 'IDR' } });
    await expect(useCase.getEvent('evt_missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getEvent returns a null priceFrom when the event has no categories', async () => {
    const { store, useCase } = buildUseCase();
    store.categories.clear();
    const event = await useCase.getEvent('evt_2026_gbk');
    expect(event.priceFrom).toBeNull();
  });

  it('getCategories returns live availability and the Detail expiry window', async () => {
    const { useCase } = buildUseCase();
    const admission = { expiresAt: new Date(Date.now() + 16 * 60 * 1000).toISOString(), maxTickets: 2 };
    const result = await useCase.getCategories('evt_2026_gbk', admission);
    expect(result.eventId).toBe('evt_2026_gbk');
    expect(result.categories).toHaveLength(3);
    expect(result.maxTickets).toBe(2);
    expect(result.maxTicketsPerOrder).toBe(3);
    expect(result.adminFee).toEqual({ amount: 15000, currency: 'IDR' });
    expect(result.expiresAt).toBeDefined();
    expect(result.serverNow).toBeDefined();
    // The Detail window ends 10 minutes before the admission TTL.
    const expected = new Date(new Date(admission.expiresAt).getTime() - 10 * 60 * 1000).toISOString();
    expect(result.expiresAt).toBe(expected);
  });

  it('getCategories defaults the admission (16 min TTL, 3 tickets) when none is given', async () => {
    const { useCase } = buildUseCase();
    const before = Date.now();
    const result = await useCase.getCategories('evt_2026_gbk');
    expect(result.maxTickets).toBe(3);
    const expiresAt = new Date(result.expiresAt).getTime();
    // ~6 minutes from now (16 min TTL minus the 10 min payment window).
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(before + 7 * 60 * 1000);
  });

  it('getCategories throws 404 for an unknown event', async () => {
    const { useCase } = buildUseCase();
    await expect(useCase.getCategories('evt_missing', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
