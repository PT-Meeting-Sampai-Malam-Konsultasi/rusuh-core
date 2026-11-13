const { MemoryStore } = require('@/infrastructure/persistence/store');
const { MemoryStock } = require('@/infrastructure/cache/stock');
const { MemoryQueueFeed } = require('@/infrastructure/cache/queue-feed');
const { createQueueFeedUseCase } = require('@/application/queue-feed/queue-feed.use-case');

// Seed event evt_2026_gbk: waiting room 2026-11-14T02:30Z, sale 03:00Z, end 2026-11-20T16:59:59Z,
// categories VIP 500 + Festival B 8000 + Tribun 3500.
const DURING_SALE = new Date('2026-11-15T00:00:00Z');
const BEFORE_WAITING_ROOM = new Date('2026-11-14T02:00:00Z');
const AFTER_END = new Date('2026-11-21T00:00:00Z');

function setup() {
  const store = new MemoryStore();
  const stock = new MemoryStock();
  const feed = new MemoryQueueFeed({ counter: (key) => stock.counters.get(key) });
  const logger = { error: jest.fn() };
  const queueFeed = createQueueFeedUseCase({ store, feed, logger });
  return { store, stock, feed, logger, queueFeed };
}

describe('queue feed use case', () => {
  it('publishes the sale and stock, then lists the event, once the waiting room opens', async () => {
    const { feed, queueFeed } = setup();
    expect(await queueFeed.sync(DURING_SALE)).toEqual({
      listed: ['evt_2026_gbk'],
      added: ['evt_2026_gbk'],
      removed: []
    });
    expect(feed.sales.get('evt_2026_gbk')).toMatchObject({
      v: 1,
      eventId: 'evt_2026_gbk',
      status: 'published',
      saleOpensAt: '2026-11-14T03:00:00.000Z'
    });
    expect(feed.stocks.get('evt_2026_gbk')).toMatchObject({ available: 12000, version: 1 });
    expect([...feed.listed]).toEqual(['evt_2026_gbk']);
  });

  it('writes the sale and stock before listing the event', async () => {
    const { feed, queueFeed } = setup();
    const order = [];
    ['publishSale', 'publishStock', 'syncListing'].forEach((name) => {
      const original = feed[name].bind(feed);
      feed[name] = async (...args) => {
        order.push(name);
        return original(...args);
      };
    });
    await queueFeed.sync(DURING_SALE);
    expect(order).toEqual(['publishSale', 'publishStock', 'syncListing']);
  });

  it('lists nothing before the waiting room opens', async () => {
    const { feed, queueFeed } = setup();
    expect(await queueFeed.sync(BEFORE_WAITING_ROOM)).toEqual({ listed: [], added: [], removed: [] });
    expect(feed.sales.size).toBe(0);
  });

  it('drops the event from the list after the sale ends', async () => {
    const { queueFeed } = setup();
    await queueFeed.sync(DURING_SALE);
    expect(await queueFeed.sync(AFTER_END)).toEqual({ listed: [], added: [], removed: ['evt_2026_gbk'] });
  });

  it('never lists a draft', async () => {
    const { store, queueFeed } = setup();
    store.events.get('evt_2026_gbk').state = 'draft';
    expect((await queueFeed.sync(DURING_SALE)).listed).toEqual([]);
  });

  it('leaves the list alone when an event could not be published, and says why', async () => {
    const { feed, queueFeed } = setup();
    await queueFeed.sync(DURING_SALE);
    feed.publishStock = async () => {
      throw new Error('valkey down');
    };
    feed.syncListing = jest.fn();
    await expect(queueFeed.sync(DURING_SALE)).rejects.toThrow('valkey down');
    expect(feed.syncListing).not.toHaveBeenCalled();
  });

  it('snapshots the stock of a listed event when a booking changes it', async () => {
    const { stock, feed, queueFeed } = setup();
    await stock.checkAndHold('evt_2026_gbk', [{ categoryId: 'cat_vip', qty: 2, nikHmacs: ['n1'] }]);
    expect(await queueFeed.stockChanged('evt_2026_gbk', DURING_SALE)).toBe(true);
    expect(feed.stocks.get('evt_2026_gbk')).toMatchObject({ available: 11998 });
  });

  it('does not snapshot an event the queue does not have', async () => {
    const { feed, queueFeed } = setup();
    expect(await queueFeed.stockChanged('evt_2026_gbk', BEFORE_WAITING_ROOM)).toBe(false);
    expect(await queueFeed.stockChanged('evt_missing', DURING_SALE)).toBe(false);
    expect(feed.stocks.size).toBe(0);
  });

  it('never fails the booking when the snapshot fails: it logs and moves on', async () => {
    const { feed, logger, queueFeed } = setup();
    feed.publishStock = async () => {
      throw new Error('valkey down');
    };
    expect(await queueFeed.stockChanged('evt_2026_gbk', DURING_SALE)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('valkey down'));
  });

  it('relays the outbox to stream:booking in order', async () => {
    const { store, feed, queueFeed } = setup();
    store.outbox.push(
      { id: 'ob_1', type: 'booking.held', payload: { id: 'ob_1' }, sent: false },
      { id: 'ob_2', type: 'booking.paid', payload: { id: 'ob_2' }, sent: false }
    );
    expect(await queueFeed.relay()).toBe(2);
    expect(feed.stream).toEqual([
      { type: 'booking.held', payload: { id: 'ob_1' } },
      { type: 'booking.paid', payload: { id: 'ob_2' } }
    ]);
    expect(await queueFeed.relay()).toBe(0);
  });
});
