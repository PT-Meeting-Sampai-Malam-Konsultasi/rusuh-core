/**
 * Live stock (Valkey, D8). Two implementations behind one interface:
 *  - MemoryStock: in-memory, same key layout + same check-and-hold semantics
 *    as the Lua scripts (tests, local dev).
 *  - RedisStock: ioredis, runs the real Lua scripts atomically.
 *
 * Key layout (LLD-02 §9):
 *  stock:{event}:{cat}:available | :held | :sold
 *  nik:{event}:{nik_hmac}            (counter, max 3 per NIK per event)
 *  admission:{token}                 (entry {user_id, event_id, slot_id, max_tickets, expires_at})
 *  admission:{token}:validated       (set of nik_hmac already validated for this order)
 *  denylist:{jti}                    (read via @rusuh/auth isDenied)
 * Lua NEVER receives a raw NIK — only the HMAC blind index (D24).
 */

/* eslint-disable max-classes-per-file -- Memory + real adapters share one interface per file by design. */
const Redis = require('ioredis');
const { seedData } = require('../persistence/store');

const MAX_SEATS_PER_NIK = 3;

/**
 * Atomic check-and-hold (LLD-02 §6.1). All-or-nothing:
 *  per category: available >= qty, else CATEGORY_SOLD_OUT;
 *  per NIK (qty aggregated across categories): counter + qty <= 3, else NIK_SEAT_TAKEN.
 * On success: DECR available, INCR held, INCR nik counters.
 * The Lua returns the final API error codes directly (no mapping layer):
 * { ok: true } or { ok: false, code: 'CATEGORY_SOLD_OUT'|'NIK_SEAT_TAKEN', categoryId?, nikHmac? }.
 */
const LUA_CHECK_AND_HOLD = `
local items = cjson.decode(ARGV[1])
local maxPerNik = tonumber(ARGV[2])
local eventId = ARGV[3]
-- 1. stock per category
for _, item in ipairs(items) do
  local available = tonumber(redis.call('GET', 'stock:' .. eventId .. ':' .. item.category_id .. ':available') or '0')
  if available < item.qty then
    return {0, 'CATEGORY_SOLD_OUT', item.category_id}
  end
end
-- 2. quota per NIK (qty aggregated across categories)
local perNik = {}
for _, item in ipairs(items) do
  for _, nikHmac in ipairs(item.nik_hmacs) do
    perNik[nikHmac] = (perNik[nikHmac] or 0) + item.qty
  end
end
for nikHmac, qty in pairs(perNik) do
  local counter = tonumber(redis.call('GET', 'nik:' .. eventId .. ':' .. nikHmac) or '0')
  if counter + qty > maxPerNik then
    return {0, 'NIK_SEAT_TAKEN', nikHmac}
  end
end
-- 3. all pass: apply
for _, item in ipairs(items) do
  redis.call('DECRBY', 'stock:' .. eventId .. ':' .. item.category_id .. ':available', item.qty)
  redis.call('INCRBY', 'stock:' .. eventId .. ':' .. item.category_id .. ':held', item.qty)
end
for nikHmac, qty in pairs(perNik) do
  redis.call('INCRBY', 'nik:' .. eventId .. ':' .. nikHmac, qty)
end
return {1}
`;

/** Release a hold (expiry/cancel): DECR held, INCR available, DECR nik counters. */
const LUA_RELEASE = `
local items = cjson.decode(ARGV[1])
local eventId = ARGV[2]
local perNik = {}
for _, item in ipairs(items) do
  redis.call('DECRBY', 'stock:' .. eventId .. ':' .. item.category_id .. ':held', item.qty)
  redis.call('INCRBY', 'stock:' .. eventId .. ':' .. item.category_id .. ':available', item.qty)
  for _, nikHmac in ipairs(item.nik_hmacs) do
    perNik[nikHmac] = (perNik[nikHmac] or 0) + item.qty
  end
end
for nikHmac, qty in pairs(perNik) do
  redis.call('DECRBY', 'nik:' .. eventId .. ':' .. nikHmac, qty)
end
return {1}
`;

/** Settle a hold (payment success): DECR held, INCR sold. NIK counters stay (D8). */
const LUA_SETTLE = `
local items = cjson.decode(ARGV[1])
local eventId = ARGV[2]
for _, item in ipairs(items) do
  redis.call('DECRBY', 'stock:' .. eventId .. ':' .. item.category_id .. ':held', item.qty)
  redis.call('INCRBY', 'stock:' .. eventId .. ':' .. item.category_id .. ':sold', item.qty)
end
return {1}
`;

/** The Lua scripts read snake_case item fields; the use case speaks camelCase. */
function luaItemsJson(items) {
  return JSON.stringify(
    items.map((item) => ({ category_id: item.categoryId, qty: item.qty, nik_hmacs: item.nikHmacs }))
  );
}

function stockKey(eventId, categoryId, field) {
  return `stock:${eventId}:${categoryId}:${field}`;
}

function nikKey(eventId, nikHmac) {
  return `nik:${eventId}:${nikHmac}`;
}

function admissionKey(token) {
  return `admission:${token}`;
}

class MemoryStock {
  constructor(seed = true) {
    this.counters = new Map(); // key -> number
    this.admissions = new Map(); // token -> { entry, expiresAtMs }
    this.validated = new Map(); // token -> Set(nikHmac)
    if (seed) {
      // Seed available stock from the seed event categories.
      const { categories } = seedData();
      categories.forEach((category) => {
        this.counters.set(stockKey(category.eventId, category.categoryId, 'available'), category.total);
        this.counters.set(stockKey(category.eventId, category.categoryId, 'held'), 0);
        this.counters.set(stockKey(category.eventId, category.categoryId, 'sold'), 0);
      });
    }
  }

  async getAvailable(eventId, categoryId) {
    return this.counters.get(stockKey(eventId, categoryId, 'available')) || 0;
  }

  async getNikCount(eventId, nikHmac) {
    return this.counters.get(nikKey(eventId, nikHmac)) || 0;
  }

  /**
   * Check-and-hold with the same semantics as LUA_CHECK_AND_HOLD.
   *
   * @param {string} eventId
   * @param {Array<{categoryId: string, qty: number, nikHmacs: string[]}>} items
   * @returns {Promise<{ok: boolean, code?: string, categoryId?: string, nikHmac?: string}>}
   */
  async checkAndHold(eventId, items) {
    const short = items.find(
      (item) => (this.counters.get(stockKey(eventId, item.categoryId, 'available')) || 0) < item.qty
    );
    if (short) return { ok: false, code: 'CATEGORY_SOLD_OUT', categoryId: short.categoryId };
    const perNik = new Map();
    items.forEach((item) => {
      item.nikHmacs.forEach((nikHmac) => perNik.set(nikHmac, (perNik.get(nikHmac) || 0) + item.qty));
    });
    const over = [...perNik].find(
      ([nikHmac, qty]) => (this.counters.get(nikKey(eventId, nikHmac)) || 0) + qty > MAX_SEATS_PER_NIK
    );
    if (over) return { ok: false, code: 'NIK_SEAT_TAKEN', nikHmac: over[0] };
    items.forEach((item) => {
      const availableKey = stockKey(eventId, item.categoryId, 'available');
      const heldKey = stockKey(eventId, item.categoryId, 'held');
      this.counters.set(availableKey, (this.counters.get(availableKey) || 0) - item.qty);
      this.counters.set(heldKey, (this.counters.get(heldKey) || 0) + item.qty);
    });
    [...perNik].forEach(([nikHmac, qty]) => {
      const key = nikKey(eventId, nikHmac);
      this.counters.set(key, (this.counters.get(key) || 0) + qty);
    });
    return { ok: true };
  }

  async release(eventId, items) {
    const perNik = new Map();
    items.forEach((item) => {
      const availableKey = stockKey(eventId, item.categoryId, 'available');
      const heldKey = stockKey(eventId, item.categoryId, 'held');
      this.counters.set(heldKey, (this.counters.get(heldKey) || 0) - item.qty);
      this.counters.set(availableKey, (this.counters.get(availableKey) || 0) + item.qty);
      item.nikHmacs.forEach((nikHmac) => perNik.set(nikHmac, (perNik.get(nikHmac) || 0) + item.qty));
    });
    [...perNik].forEach(([nikHmac, qty]) => {
      const key = nikKey(eventId, nikHmac);
      this.counters.set(key, Math.max((this.counters.get(key) || 0) - qty, 0));
    });
    return { ok: true };
  }

  async settle(eventId, items) {
    items.forEach((item) => {
      const heldKey = stockKey(eventId, item.categoryId, 'held');
      const soldKey = stockKey(eventId, item.categoryId, 'sold');
      this.counters.set(heldKey, (this.counters.get(heldKey) || 0) - item.qty);
      this.counters.set(soldKey, (this.counters.get(soldKey) || 0) + item.qty);
    });
    return { ok: true };
  }

  async setAdmission(token, entry, ttlMs) {
    this.admissions.set(token, { entry, expiresAtMs: Date.now() + ttlMs });
  }

  async getAdmission(token) {
    const record = this.admissions.get(token);
    if (!record) return null;
    if (record.expiresAtMs <= Date.now()) {
      this.admissions.delete(token);
      return null;
    }
    return record.entry;
  }

  async addValidatedNik(token, nikHmac) {
    if (!this.validated.has(token)) this.validated.set(token, new Set());
    this.validated.get(token).add(nikHmac);
  }

  async getValidatedNiks(token) {
    return [...(this.validated.get(token) || [])];
  }

  async isDenied(jti) {
    return this.counters.has(`denylist:${jti}`);
  }

  async close() {
    // No resources to release.
  }
}

class RedisStock {
  constructor(client) {
    this.client = client;
    this.client.defineCommand('checkAndHold', { numberOfKeys: 0, lua: LUA_CHECK_AND_HOLD });
    this.client.defineCommand('releaseHold', { numberOfKeys: 0, lua: LUA_RELEASE });
    this.client.defineCommand('settleHold', { numberOfKeys: 0, lua: LUA_SETTLE });
  }

  static async connect(url) {
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
    await client.connect();
    return new RedisStock(client);
  }

  async getAvailable(eventId, categoryId) {
    return Number(await this.client.get(stockKey(eventId, categoryId, 'available'))) || 0;
  }

  async getNikCount(eventId, nikHmac) {
    return Number(await this.client.get(nikKey(eventId, nikHmac))) || 0;
  }

  async checkAndHold(eventId, items) {
    const result = await this.client.checkAndHold(luaItemsJson(items), MAX_SEATS_PER_NIK, eventId);
    if (result[0] === 1) return { ok: true };
    // The Lua returns the final API error code directly; pass it through unchanged.
    if (result[1] === 'CATEGORY_SOLD_OUT') return { ok: false, code: 'CATEGORY_SOLD_OUT', categoryId: result[2] };
    return { ok: false, code: 'NIK_SEAT_TAKEN', nikHmac: result[2] };
  }

  async release(eventId, items) {
    await this.client.releaseHold(luaItemsJson(items), eventId);
    return { ok: true };
  }

  async settle(eventId, items) {
    await this.client.settleHold(luaItemsJson(items), eventId);
    return { ok: true };
  }

  async setAdmission(token, entry, ttlMs) {
    await this.client.set(admissionKey(token), JSON.stringify(entry), 'PX', ttlMs);
  }

  async getAdmission(token) {
    const raw = await this.client.get(admissionKey(token));
    return raw ? JSON.parse(raw) : null;
  }

  async addValidatedNik(token, nikHmac) {
    const key = `${admissionKey(token)}:validated`;
    await this.client.sadd(key, nikHmac);
    const ttl = await this.client.pttl(admissionKey(token));
    if (ttl > 0) await this.client.pexpire(key, ttl);
  }

  async getValidatedNiks(token) {
    return this.client.smembers(`${admissionKey(token)}:validated`);
  }

  async isDenied(jti) {
    return (await this.client.exists(`denylist:${jti}`)) === 1;
  }

  async close() {
    await this.client.quit();
  }
}

module.exports = {
  MemoryStock,
  RedisStock,
  LUA_CHECK_AND_HOLD,
  LUA_RELEASE,
  LUA_SETTLE,
  MAX_SEATS_PER_NIK,
  stockKey,
  nikKey,
  admissionKey
};
