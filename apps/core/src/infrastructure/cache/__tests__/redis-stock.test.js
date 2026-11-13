const {
  RedisStock,
  stockKey,
  nikKey,
  admissionKey,
  LUA_CHECK_AND_HOLD,
  LUA_RELEASE,
  LUA_SETTLE
} = require('@/infrastructure/cache/stock');

/** A fake ioredis client: records calls, returns canned values. */
function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    defineCommand: jest.fn((name) => {
      client[name] = jest.fn(async (...args) => {
        calls.push({ command: name, args });
        return client[`__${name}`] ? client[`__${name}`](...args) : [1];
      });
    }),
    get: jest.fn(async (key) => {
      calls.push({ command: 'get', args: [key] });
      return client.__get ? client.__get(key) : null;
    }),
    set: jest.fn(async (...args) => {
      calls.push({ command: 'set', args });
      return 'OK';
    }),
    del: jest.fn(async (...args) => {
      calls.push({ command: 'del', args });
      return 1;
    }),
    sadd: jest.fn(async (...args) => {
      calls.push({ command: 'sadd', args });
      return 1;
    }),
    smembers: jest.fn(async (key) => {
      calls.push({ command: 'smembers', args: [key] });
      return client.__smembers ? client.__smembers(key) : [];
    }),
    pttl: jest.fn(async (key) => {
      calls.push({ command: 'pttl', args: [key] });
      return client.__pttl ? client.__pttl(key) : -1;
    }),
    pexpire: jest.fn(async (...args) => {
      calls.push({ command: 'pexpire', args });
      return 1;
    }),
    exists: jest.fn(async (key) => {
      calls.push({ command: 'exists', args: [key] });
      return client.__exists ? client.__exists(key) : 0;
    }),
    quit: jest.fn(async () => {
      calls.push({ command: 'quit', args: [] });
      return 'OK';
    }),
    ...overrides
  };
  return client;
}

describe('RedisStock (live Valkey adapter, fake client)', () => {
  it('defines the three Lua commands on construction', () => {
    const client = fakeClient();
    const stock = new RedisStock(client);
    expect(stock).toBeDefined();
    expect(client.defineCommand).toHaveBeenCalledTimes(3);
    expect(client.defineCommand).toHaveBeenCalledWith('checkAndHold', expect.objectContaining({ numberOfKeys: 0 }));
    expect(client.defineCommand).toHaveBeenCalledWith('releaseHold', expect.objectContaining({ numberOfKeys: 0 }));
    expect(client.defineCommand).toHaveBeenCalledWith('settleHold', expect.objectContaining({ numberOfKeys: 0 }));
  });

  it('reads the counters (available / NIK) via the right keys', async () => {
    const client = fakeClient({
      __get: (key) => {
        if (key === stockKey('evt_1', 'cat_1', 'available')) return '7';
        if (key === nikKey('evt_1', 'hmac_1')) return '3';
        return null;
      }
    });
    const stock = new RedisStock(client);
    await expect(stock.getAvailable('evt_1', 'cat_1')).resolves.toBe(7);
    await expect(stock.getNikCount('evt_1', 'hmac_1')).resolves.toBe(3);
    await expect(stock.getAvailable('evt_1', 'cat_missing')).resolves.toBe(0);
  });

  it('checkAndHold passes the Lua result through: ok / CATEGORY_SOLD_OUT / NIK_SEAT_TAKEN', async () => {
    const client = fakeClient();
    const stock = new RedisStock(client);
    const items = [{ categoryId: 'cat_1', nikHmacs: ['hmac_1'] }];

    client.__checkAndHold = async () => [1];
    await expect(stock.checkAndHold('evt_1', items)).resolves.toEqual({ ok: true });

    client.__checkAndHold = async () => [0, 'CATEGORY_SOLD_OUT', 'cat_1'];
    await expect(stock.checkAndHold('evt_1', items)).resolves.toEqual({
      ok: false,
      code: 'CATEGORY_SOLD_OUT',
      categoryId: 'cat_1'
    });

    client.__checkAndHold = async () => [0, 'NIK_SEAT_TAKEN', 'hmac_1'];
    await expect(stock.checkAndHold('evt_1', items)).resolves.toEqual({
      ok: false,
      code: 'NIK_SEAT_TAKEN',
      nikHmac: 'hmac_1'
    });
    expect(client.checkAndHold).toHaveBeenCalledWith(
      JSON.stringify([{ category_id: 'cat_1', nik_hmacs: ['hmac_1'] }]),
      3,
      'evt_1'
    );
  });

  it('release and settle call the Lua commands and return ok', async () => {
    const client = fakeClient();
    const stock = new RedisStock(client);
    const items = [{ categoryId: 'cat_1', nikHmacs: ['hmac_1'] }];
    await expect(stock.release('evt_1', items)).resolves.toEqual({ ok: true });
    await expect(stock.settle('evt_1', items)).resolves.toEqual({ ok: true });
    expect(client.releaseHold).toHaveBeenCalledWith(
      JSON.stringify([{ category_id: 'cat_1', nik_hmacs: ['hmac_1'] }]),
      'evt_1'
    );
    expect(client.settleHold).toHaveBeenCalledWith(
      JSON.stringify([{ category_id: 'cat_1', nik_hmacs: ['hmac_1'] }]),
      'evt_1'
    );
  });

  it('stores and reads an admission entry', async () => {
    const client = fakeClient({
      __get: (key) => (key === admissionKey('adm_1') ? JSON.stringify({ user_id: 'acc_1' }) : null)
    });
    const stock = new RedisStock(client);
    const entry = { user_id: 'acc_1', event_id: 'evt_1' };
    await stock.setAdmission('adm_1', entry, 960000);
    expect(client.set).toHaveBeenCalledWith(admissionKey('adm_1'), JSON.stringify(entry), 'PX', 960000);
    await expect(stock.getAdmission('adm_1')).resolves.toEqual({ user_id: 'acc_1' });
    await expect(stock.getAdmission('adm_missing')).resolves.toBeNull();
  });

  it('tracks validated NIKs and copies the admission TTL onto the set', async () => {
    const client = fakeClient({
      __pttl: () => 500000,
      __smembers: () => ['hmac_1', 'hmac_2']
    });
    const stock = new RedisStock(client);
    await stock.addValidatedNik('adm_1', 'hmac_1');
    expect(client.sadd).toHaveBeenCalledWith(`${admissionKey('adm_1')}:validated`, 'hmac_1');
    expect(client.pexpire).toHaveBeenCalledWith(`${admissionKey('adm_1')}:validated`, 500000);
    await expect(stock.getValidatedNiks('adm_1')).resolves.toEqual(['hmac_1', 'hmac_2']);
  });

  it('does not set a TTL on the validated set when the admission has none', async () => {
    const client = fakeClient({ __pttl: () => -1 });
    const stock = new RedisStock(client);
    await stock.addValidatedNik('adm_1', 'hmac_1');
    expect(client.pexpire).not.toHaveBeenCalled();
  });

  it('isDenied reads the denylist key (the write side lives in the auth-module; core only reads)', async () => {
    const client = fakeClient({ __exists: () => 1 });
    const stock = new RedisStock(client);
    await expect(stock.isDenied('jti-1')).resolves.toBe(true);
    const client2 = fakeClient({ __exists: () => 0 });
    const stock2 = new RedisStock(client2);
    await expect(stock2.isDenied('jti-2')).resolves.toBe(false);
  });

  it('close quits the client', async () => {
    const client = fakeClient();
    const stock = new RedisStock(client);
    await stock.close();
    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['checkAndHold', 'checkAndHold'],
    ['release', 'releaseHold'],
    ['settle', 'settleHold']
  ])('%s hands the Lua the item fields it reads (category_id, qty, nik_hmacs)', async (method, command) => {
    const client = fakeClient();
    const stock = new RedisStock(client);
    await stock[method]('evt_1', [{ categoryId: 'cat_1', qty: 2, nikHmacs: ['h1', 'h2'] }]);
    const call = client.calls.find((c) => c.command === command);
    expect(JSON.parse(call.args[0])).toEqual([{ category_id: 'cat_1', qty: 2, nik_hmacs: ['h1', 'h2'] }]);
  });

  it('the Lua scripts read exactly those fields', () => {
    [LUA_CHECK_AND_HOLD, LUA_RELEASE, LUA_SETTLE].forEach((lua) => {
      expect(lua).toContain('item.category_id');
      expect(lua).not.toMatch(/item\.categoryId|item\.nikHmacs/);
    });
  });
});
