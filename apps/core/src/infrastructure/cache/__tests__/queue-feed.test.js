const { RedisQueueFeed, MemoryQueueFeed, LUA_STOCK_SNAPSHOT } = require('@/infrastructure/cache/queue-feed');

const SALE = {
  v: 1,
  eventId: 'evt_1',
  status: 'published',
  waitingRoomOpensAt: '2026-11-14T02:30:00.000Z',
  saleOpensAt: '2026-11-14T03:00:00.000Z',
  endsAt: '2026-11-20T16:59:59.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z'
};

/** A fake ioredis client: records calls, answers from a small key/value map. */
function fakeClient({ values = {}, members = [] } = {}) {
  const calls = [];
  const record = (command) =>
    jest.fn(async (...args) => {
      calls.push([command, ...args]);
      return 1;
    });
  const client = {
    calls,
    defineCommand: jest.fn((name) => {
      client[name] = jest.fn(async (...args) => {
        calls.push([name, ...args]);
        return [42, 7];
      });
    }),
    get: jest.fn(async (key) => values[key] ?? null),
    smembers: jest.fn(async () => members),
    set: record('set'),
    pexpire: record('pexpire'),
    sadd: record('sadd'),
    srem: record('srem'),
    call: record('call'),
    xadd: jest.fn(async (...args) => {
      calls.push(['xadd', ...args]);
      return '1731-0';
    })
  };
  return client;
}

describe('RedisQueueFeed (shared-keys.md)', () => {
  it('writes a changed sale document with its TTL, then nudges the event', async () => {
    const client = fakeClient();
    const changed = await new RedisQueueFeed(client).publishSale(SALE, 60000);
    expect(changed).toBe(true);
    expect(client.calls).toEqual([
      ['set', 'core:{evt_1}:sale', JSON.stringify(SALE), 'PX', 60000],
      ['call', 'SPUBLISH', 'core:{evt_1}:changed', '1']
    ]);
  });

  it('only refreshes the TTL when the sale has not changed (no nudge every 5 s)', async () => {
    const stored = JSON.stringify({ ...SALE, updatedAt: '2026-11-12T00:00:00.000Z' });
    const client = fakeClient({ values: { 'core:{evt_1}:sale': stored } });
    const changed = await new RedisQueueFeed(client).publishSale(SALE, 60000);
    expect(changed).toBe(false);
    expect(client.calls).toEqual([['pexpire', 'core:{evt_1}:sale', 60000]]);
  });

  it('rewrites a sale whose times moved', async () => {
    const stored = JSON.stringify({ ...SALE, saleOpensAt: '2026-11-14T04:00:00.000Z' });
    const client = fakeClient({ values: { 'core:{evt_1}:sale': stored } });
    expect(await new RedisQueueFeed(client).publishSale(SALE, 60000)).toBe(true);
  });

  it('rewrites a stored sale that is not json', async () => {
    const client = fakeClient({ values: { 'core:{evt_1}:sale': '{' } });
    expect(await new RedisQueueFeed(client).publishSale(SALE, 60000)).toBe(true);
  });

  it('snapshots stock in one script: counters summed, version taken, document set and nudged together', async () => {
    const client = fakeClient();
    const now = new Date('2026-11-14T03:00:05.000Z');
    const result = await new RedisQueueFeed(client).publishStock('evt_1', ['cat_a', 'cat_b'], 60000, now);
    expect(result).toEqual({ available: 42, version: 7 });
    expect(client.calls).toEqual([
      [
        'queueStockSnapshot',
        4,
        'core:{evt_1}:stock',
        'core:{evt_1}:stock:version',
        'stock:evt_1:cat_a:available',
        'stock:evt_1:cat_b:available',
        'evt_1',
        '2026-11-14T03:00:05.000Z',
        60000,
        'core:{evt_1}:changed'
      ]
    ]);
  });

  it('the stock script never publishes a negative count and expires its version with the document', () => {
    expect(LUA_STOCK_SNAPSHOT).toContain("math.max(tonumber(redis.call('GET', KEYS[i]) or '0') or 0, 0)");
    expect(LUA_STOCK_SNAPSHOT).toContain("redis.call('PEXPIRE', KEYS[2], ARGV[3])");
    expect(LUA_STOCK_SNAPSHOT).toContain("redis.call('SPUBLISH', ARGV[4], '1')");
  });

  it('lists new events, drops ended ones and nudges once', async () => {
    const client = fakeClient({ members: ['evt_old', 'evt_kept'] });
    const result = await new RedisQueueFeed(client).syncListing(['evt_kept', 'evt_new']);
    expect(result).toEqual({ added: ['evt_new'], removed: ['evt_old'] });
    expect(client.calls).toEqual([
      ['sadd', 'core:events', 'evt_new'],
      ['srem', 'core:events', 'evt_old'],
      ['call', 'SPUBLISH', 'core:events:changed', '1']
    ]);
  });

  it('does not nudge when the list is unchanged', async () => {
    const client = fakeClient({ members: ['evt_1'] });
    expect(await new RedisQueueFeed(client).syncListing(['evt_1'])).toEqual({ added: [], removed: [] });
    expect(client.calls).toEqual([]);
  });

  it('appends a booking event the way the queue consumer reads it', async () => {
    const client = fakeClient();
    const payload = { v: 1, id: 'ob_1', type: 'booking.paid' };
    expect(await new RedisQueueFeed(client).appendBookingEvent('booking.paid', payload)).toBe('1731-0');
    expect(client.calls).toEqual([
      ['xadd', 'stream:booking', '*', 'type', 'booking.paid', 'payload', JSON.stringify(payload)]
    ]);
  });
});

describe('MemoryQueueFeed', () => {
  it('keeps what was published (local dev and tests)', async () => {
    const stock = new Map([['stock:evt_1:cat_a:available', 5]]);
    const feed = new MemoryQueueFeed({ counter: (key) => stock.get(key) || 0 });
    expect(await feed.publishSale(SALE, 1000)).toBe(true);
    expect(await feed.publishSale({ ...SALE, updatedAt: 'later' }, 1000)).toBe(false);
    expect(await feed.publishStock('evt_1', ['cat_a', 'cat_b'], 1000, new Date(0))).toEqual({
      available: 5,
      version: 1
    });
    expect(await feed.publishStock('evt_1', ['cat_a'], 1000, new Date(0))).toEqual({ available: 5, version: 2 });
    expect(await feed.syncListing(['evt_1'])).toEqual({ added: ['evt_1'], removed: [] });
    expect(await feed.syncListing([])).toEqual({ added: [], removed: ['evt_1'] });
    await feed.appendBookingEvent('booking.paid', { id: 'ob_1' });
    expect(feed.sales.get('evt_1')).toEqual(SALE);
    expect(feed.stocks.get('evt_1')).toMatchObject({ v: 1, eventId: 'evt_1', available: 5, version: 2 });
    expect(feed.stream).toEqual([{ type: 'booking.paid', payload: { id: 'ob_1' } }]);
  });

  it('counts nothing without a stock source', async () => {
    expect(await new MemoryQueueFeed().publishStock('evt_1', ['cat_a'], 1000, new Date(0))).toEqual({
      available: 0,
      version: 1
    });
  });
});
