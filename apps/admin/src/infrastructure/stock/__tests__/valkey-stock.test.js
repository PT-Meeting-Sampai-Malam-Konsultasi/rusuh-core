const { createStockSeeder } = require('@/infrastructure/stock/valkey-stock');

describe('createStockSeeder', () => {
  it('seeds available/held/sold with SET NX using core key layout', async () => {
    const calls = [];
    const pipeline = { set: (...args) => calls.push(args), exec: jest.fn().mockResolvedValue([]) };
    const seeder = createStockSeeder({ client: { multi: () => pipeline } });
    await seeder.seedCategories('evt_1', [{ category_id: 'cat_a', total: 500 }]);
    expect(calls).toEqual([
      ['stock:evt_1:cat_a:available', 500, 'NX'],
      ['stock:evt_1:cat_a:held', 0, 'NX'],
      ['stock:evt_1:cat_a:sold', 0, 'NX']
    ]);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without a Valkey URL', async () => {
    const seeder = createStockSeeder({});
    expect(seeder.isEnabled).toBe(false);
    await expect(seeder.seedCategories('evt_1', [{ category_id: 'c', total: 1 }])).resolves.toBeUndefined();
  });
});
