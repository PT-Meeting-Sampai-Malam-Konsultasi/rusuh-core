const { MemoryStock, LUA_CHECK_AND_HOLD, LUA_RELEASE, LUA_SETTLE } = require('@/infrastructure/cache/stock');

describe('MemoryStock (Lua semantics, D8)', () => {
  const eventId = 'evt_2026_gbk';
  const categoryId = 'cat_vip';
  const nikHmac = 'hmac-nik-1';
  let stock;

  beforeEach(() => {
    stock = new MemoryStock(); // seeded from the Samudra categories (cat_vip: 500)
  });

  it('seeds available stock from the category total', async () => {
    expect(await stock.getAvailable(eventId, categoryId)).toBe(500);
  });

  it('holds atomically: DECR available, INCR NIK counter', async () => {
    const result = await stock.checkAndHold(eventId, [{ categoryId, qty: 2, nikHmacs: [nikHmac] }]);
    expect(result).toEqual({ ok: true });
    expect(await stock.getAvailable(eventId, categoryId)).toBe(498);
    expect(await stock.getNikCount(eventId, nikHmac)).toBe(2);
  });

  it('rejects a hold that exceeds available stock (CATEGORY_SOLD_OUT)', async () => {
    const result = await stock.checkAndHold(eventId, [{ categoryId, qty: 501, nikHmacs: [nikHmac] }]);
    expect(result).toEqual({ ok: false, code: 'CATEGORY_SOLD_OUT', categoryId });
    expect(await stock.getAvailable(eventId, categoryId)).toBe(500);
    expect(await stock.getNikCount(eventId, nikHmac)).toBe(0);
  });

  it('rejects a hold that would exceed the 3-seat NIK quota (NIK_SEAT_TAKEN)', async () => {
    await stock.checkAndHold(eventId, [{ categoryId, qty: 2, nikHmacs: [nikHmac] }]);
    const result = await stock.checkAndHold(eventId, [{ categoryId, qty: 2, nikHmacs: [nikHmac] }]);
    expect(result).toEqual({ ok: false, code: 'NIK_SEAT_TAKEN', nikHmac });
    // The failed hold leaves the state untouched.
    expect(await stock.getAvailable(eventId, categoryId)).toBe(498);
    expect(await stock.getNikCount(eventId, nikHmac)).toBe(2);
  });

  it('aggregates the quota across multiple NIKs in one hold', async () => {
    await stock.checkAndHold(eventId, [{ categoryId, qty: 2, nikHmacs: ['nik-a', 'nik-b'] }]);
    const result = await stock.checkAndHold(eventId, [{ categoryId, qty: 2, nikHmacs: ['nik-a', 'nik-a'] }]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NIK_SEAT_TAKEN');
    expect(result.nikHmac).toBe('nik-a');
  });

  it('releases a hold: INCR available, DECR NIK counter', async () => {
    await stock.checkAndHold(eventId, [{ categoryId, qty: 3, nikHmacs: [nikHmac] }]);
    await stock.release(eventId, [{ categoryId, qty: 3, nikHmacs: [nikHmac] }]);
    expect(await stock.getAvailable(eventId, categoryId)).toBe(500);
    expect(await stock.getNikCount(eventId, nikHmac)).toBe(0);
  });

  it('settles a hold: DECR held, NIK counter stays (D8)', async () => {
    await stock.checkAndHold(eventId, [{ categoryId, qty: 3, nikHmacs: [nikHmac] }]);
    await stock.settle(eventId, [{ categoryId, qty: 3, nikHmacs: [nikHmac] }]);
    expect(await stock.getAvailable(eventId, categoryId)).toBe(497);
    expect(await stock.getNikCount(eventId, nikHmac)).toBe(3);
  });

  it('stores and retrieves an admission entry with a TTL', async () => {
    await stock.setAdmission('adm_1', { user_id: 'acc_1', event_id: eventId }, 1000);
    expect(await stock.getAdmission('adm_1')).toEqual({ user_id: 'acc_1', event_id: eventId });
    await stock.setAdmission('adm_2', { user_id: 'acc_1', event_id: eventId }, 1);
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    expect(await stock.getAdmission('adm_2')).toBeNull();
  });

  it('isDenied reads the denylist key (the write side lives in the auth-module; core only reads)', async () => {
    expect(await stock.isDenied('jti-1')).toBe(false);
    // Seed the denylist the way the shared Valkey key layout does.
    stock.counters.set('denylist:jti-1', 1);
    expect(await stock.isDenied('jti-1')).toBe(true);
  });

  it('tracks validated NIKs per admission token', async () => {
    expect(await stock.getValidatedNiks('adm_1')).toEqual([]);
    await stock.addValidatedNik('adm_1', 'hmac-a');
    expect(await stock.getValidatedNiks('adm_1')).toEqual(['hmac-a']);
  });

  it('the Lua scripts encode the same checks as the in-memory adapter', () => {
    expect(LUA_CHECK_AND_HOLD).toContain('CATEGORY_SOLD_OUT');
    expect(LUA_CHECK_AND_HOLD).toContain('NIK_SEAT_TAKEN');
    expect(LUA_CHECK_AND_HOLD).toContain('cjson.decode');
    expect(LUA_RELEASE).toContain('DECRBY');
    expect(LUA_SETTLE).toContain('sold');
  });
});
