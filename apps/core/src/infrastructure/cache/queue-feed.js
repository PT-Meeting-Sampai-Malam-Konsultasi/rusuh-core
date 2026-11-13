/* eslint-disable max-classes-per-file -- Memory + real adapters share one interface per file by design. */
const { stockKey } = require('./stock');

/**
 * Writes what the queue reads from core (rusuh-documentation/api/shared-keys.md):
 *  core:events                   set of listed event ids   (nudge: SPUBLISH core:events:changed)
 *  core:{evt}:sale | :stock      JSON documents            (nudge: SPUBLISH core:{evt}:changed)
 *  stream:booking                booking.v1 events          (read by the queue's consumer group)
 * Core is the only writer of these keys; the queue never writes core:*.
 */

const EVENTS = 'core:events';
const EVENTS_CHANGED = 'core:events:changed';
const STREAM = 'stream:booking';
const saleKey = (eventId) => `core:{${eventId}}:sale`;
const stockDocKey = (eventId) => `core:{${eventId}}:stock`;
const stockVersionKey = (eventId) => `core:{${eventId}}:stock:version`;
const changedChannel = (eventId) => `core:{${eventId}}:changed`;

/**
 * One atomic snapshot, so the version order is the order of the counts even
 * with several core tasks writing.
 * KEYS[1] document, KEYS[2] version counter, KEYS[3..] category available counters.
 * ARGV[1] event id, ARGV[2] ts, ARGV[3] TTL ms, ARGV[4] nudge channel.
 */
const LUA_STOCK_SNAPSHOT = `
local available = 0
for i = 3, #KEYS do
  available = available + math.max(tonumber(redis.call('GET', KEYS[i]) or '0') or 0, 0)
end
local version = redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
local doc = cjson.encode({ v = 1, eventId = ARGV[1], available = available, version = version, ts = ARGV[2] })
redis.call('SET', KEYS[1], doc, 'PX', ARGV[3])
redis.call('SPUBLISH', ARGV[4], '1')
return { available, version }
`;

const sameSale = (a, b) =>
  ['v', 'eventId', 'status', 'waitingRoomOpensAt', 'saleOpensAt', 'endsAt'].every((field) => a[field] === b[field]);

function parse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

class RedisQueueFeed {
  constructor(client) {
    this.client = client;
    this.client.defineCommand('queueStockSnapshot', { lua: LUA_STOCK_SNAPSHOT });
  }

  /** Writes the sale when it changed (nudging the queue); otherwise only refreshes its TTL. */
  async publishSale(doc, ttlMs) {
    const key = saleKey(doc.eventId);
    const stored = parse(await this.client.get(key));
    if (stored && sameSale(stored, doc)) {
      await this.client.pexpire(key, ttlMs);
      return false;
    }
    await this.client.set(key, JSON.stringify(doc), 'PX', ttlMs);
    await this.client.call('SPUBLISH', changedChannel(doc.eventId), '1');
    return true;
  }

  async publishStock(eventId, categoryIds, ttlMs, now) {
    const keys = [
      stockDocKey(eventId),
      stockVersionKey(eventId),
      ...categoryIds.map((id) => stockKey(eventId, id, 'available'))
    ];
    const [available, version] = await this.client.queueStockSnapshot(
      keys.length,
      ...keys,
      eventId,
      now.toISOString(),
      ttlMs,
      changedChannel(eventId)
    );
    return { available, version };
  }

  /** Makes core:events exactly the given ids; nudges the queue when it changed. */
  async syncListing(eventIds) {
    const members = new Set(await this.client.smembers(EVENTS));
    const wanted = new Set(eventIds);
    const added = [...wanted].filter((id) => !members.has(id));
    const removed = [...members].filter((id) => !wanted.has(id));
    if (added.length > 0) await this.client.sadd(EVENTS, ...added);
    if (removed.length > 0) await this.client.srem(EVENTS, ...removed);
    if (added.length > 0 || removed.length > 0) await this.client.call('SPUBLISH', EVENTS_CHANGED, '1');
    return { added, removed };
  }

  async appendBookingEvent(type, payload) {
    return this.client.xadd(STREAM, '*', 'type', type, 'payload', JSON.stringify(payload));
  }
}

class MemoryQueueFeed {
  /** @param {object} [options] - { counter(key) }: reads a stock counter (MemoryStock in local dev). */
  constructor({ counter = () => 0 } = {}) {
    this.counter = counter;
    this.sales = new Map();
    this.stocks = new Map();
    this.listed = new Set();
    this.stream = [];
  }

  async publishSale(doc) {
    const stored = this.sales.get(doc.eventId);
    if (stored && sameSale(stored, doc)) return false;
    this.sales.set(doc.eventId, doc);
    return true;
  }

  async publishStock(eventId, categoryIds, _ttlMs, now) {
    const available = categoryIds.reduce(
      (sum, id) => sum + Math.max(Number(this.counter(stockKey(eventId, id, 'available'))) || 0, 0),
      0
    );
    const version = (this.stocks.get(eventId)?.version || 0) + 1;
    this.stocks.set(eventId, { v: 1, eventId, available, version, ts: now.toISOString() });
    return { available, version };
  }

  async syncListing(eventIds) {
    const wanted = new Set(eventIds);
    const added = [...wanted].filter((id) => !this.listed.has(id));
    const removed = [...this.listed].filter((id) => !wanted.has(id));
    this.listed = wanted;
    return { added, removed };
  }

  async appendBookingEvent(type, payload) {
    this.stream.push({ type, payload });
    return String(this.stream.length);
  }
}

module.exports = { RedisQueueFeed, MemoryQueueFeed, LUA_STOCK_SNAPSHOT };
