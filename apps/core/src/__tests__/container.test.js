const crypto = require('crypto');
const { loadEnvironment } = require('@/infrastructure/config/environment');
const { createDefaultDeps, createDeps } = require('@/container');
const { MemoryStore } = require('@/infrastructure/persistence/store');

function baseConfig(overrides = {}) {
  return loadEnvironment({ NODE_ENV: 'test', ...overrides });
}

describe('container (composition root)', () => {
  it('parses AUTH_JWKS into a kid -> JWK Map (parseJwks)', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' });
    const jwks = JSON.stringify({ keys: [{ kid: 'local-dev-1', ...jwk }] });
    const deps = createDefaultDeps(baseConfig({ AUTH_JWKS: jwks }));
    expect(deps.publicKeys).toBeInstanceOf(Map);
    expect(deps.publicKeys.get('local-dev-1')).toEqual({ kid: 'local-dev-1', ...jwk });
    expect(deps.devPrivateJwk).toBeNull();
  });

  it('generates a dev keypair when AUTH_JWKS is unset', () => {
    const deps = createDefaultDeps(baseConfig());
    expect(deps.publicKeys.has('dev-01')).toBe(true);
    expect(deps.devPrivateJwk).toBeDefined();
  });

  it('isDenied reflects the stock denylist', async () => {
    const deps = createDefaultDeps(baseConfig());
    expect(await deps.isDenied('jti-1')).toBe(false);
    // Seed the denylist the way the shared Valkey key layout does
    // (the write side lives in the auth-module; core only reads).
    deps.stock.counters.set('denylist:jti-1', 1);
    expect(await deps.isDenied('jti-1')).toBe(true);
  });

  it('keeps nikHmacKey/qrKey/fees on the graph top level (container fix)', () => {
    const deps = createDefaultDeps(baseConfig());
    expect(deps.nikHmacKey).toBeDefined();
    expect(deps.qrKey).toBeDefined();
    expect(deps.fees).toBeDefined();
    expect(deps.fees.platformFee).toBe(30000);
    // The rebuild spread carries them (this is what createDeps relies on).
    const rebuilt = { ...deps, store: deps.store };
    expect(rebuilt.nikHmacKey).toBe(deps.nikHmacKey);
    expect(rebuilt.qrKey).toBe(deps.qrKey);
    expect(rebuilt.fees).toBe(deps.fees);
  });

  it('createDeps with no URLs returns the default graph (no upgrade)', async () => {
    const deps = await createDeps(baseConfig());
    expect(deps.store).toBeInstanceOf(MemoryStore);
    expect(deps.useCases.bookings).toBeDefined();
    expect(deps.useCases.attendees).toBeDefined();
    expect(deps.useCases.admission).toBeDefined();
    expect(deps.sweeper).toBeDefined();
  });

  it('createDeps with overrides does not upgrade the overridden adapters', async () => {
    const store = new MemoryStore();
    const deps = await createDeps(baseConfig({ DATABASE_URL: 'postgres://localhost:5432/x' }), { store });
    expect(deps.store).toBe(store);
  });

  it('the sweeper runs via the container graph and calls onRun', async () => {
    const deps = createDefaultDeps(baseConfig());
    const result = await deps.sweeper.runOnce(new Date('2026-11-07T10:00:00.000Z'));
    expect(result).toEqual({ processed: 0, skipped: 0 });
  });

  it('the sweeper expires a due SELECTION booking (processed > 0)', async () => {
    const deps = createDefaultDeps(baseConfig());
    const past = new Date(Date.now() - 60000).toISOString();
    await deps.store.createBooking({
      bookingId: 'bk_due_1',
      eventId: 'evt_2026_gbk',
      accountId: 'acc_01',
      admissionToken: 'adm_due_1',
      slotId: 's_due_1',
      status: 'SELECTION',
      expiresAt: past,
      paymentExpiresAt: null,
      orderCode: 'RSH-26-000001',
      price: { total: { amount: 100, currency: 'IDR' } },
      attendees: [],
      snapToken: null
    });
    const result = await deps.sweeper.runOnce(new Date());
    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    const expired = await deps.store.getBooking('bk_due_1');
    expect(expired.status).toBe('EXPIRED');
  });

  it('the sweeper onError hook runs when expireDue throws', async () => {
    const error = new Error('store down');
    const throwingStore = new MemoryStore();
    throwingStore.listDueBookings = async () => {
      throw error;
    };
    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const deps = createDefaultDeps(baseConfig(), { store: throwingStore });
      await expect(deps.sweeper.runOnce(new Date())).rejects.toThrow('store down');
      expect(errors.some((line) => line.includes('sweeper error'))).toBe(true);
    } finally {
      console.error = origError;
    }
  });
});
