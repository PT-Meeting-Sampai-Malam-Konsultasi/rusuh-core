const { buildOfficerDeps } = require('../container');
const { TEST_NIK_KEY } = require('../application/officer/__tests__/test-fixtures');

describe('buildOfficerDeps', () => {
  const baseConfig = {
    databaseUrl: null,
    nikEncryptionKey: null,
    authPublicKeys: null,
    authAudience: 'rusuh-api',
    authIssuer: 'rusuh-auth'
  };

  it('fails closed without a database: stores throw 503 SERVICE_UNAVAILABLE', async () => {
    const deps = buildOfficerDeps(baseConfig);
    await expect(deps.ticketStore.findByCodeOrId('tk_1')).rejects.toMatchObject({
      data: { code: 'SERVICE_UNAVAILABLE' }
    });
    await expect(deps.ticketStore.findEvent('evt_1')).rejects.toMatchObject({
      data: { code: 'SERVICE_UNAVAILABLE' }
    });
    await expect(deps.ticketStore.markUsed('tk_1', { usedBy: 'acc_1' })).rejects.toMatchObject({
      data: { code: 'SERVICE_UNAVAILABLE' }
    });
    await expect(deps.ticketStore.listByEvent('evt_1', { page: 1, limit: 50 })).rejects.toMatchObject({
      data: { code: 'SERVICE_UNAVAILABLE' }
    });
    await expect(deps.auditStore.insert({ action: 'X' })).rejects.toMatchObject({
      data: { code: 'SERVICE_UNAVAILABLE' }
    });
    await expect(deps.auditStore.list()).rejects.toMatchObject({ data: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('fails closed without a NIK key: decrypt/encrypt throw', async () => {
    const deps = buildOfficerDeps(baseConfig);
    await expect(deps.nikCrypto.decrypt('x:y:z')).rejects.toThrow('NIK_ENCRYPTION_KEY is not configured');
    expect(() => deps.nikCrypto.encrypt('3171010101900001')).toThrow('NIK_ENCRYPTION_KEY is not configured');
  });

  it('resolves no role without a database (roleResolver returns null)', async () => {
    const deps = buildOfficerDeps(baseConfig);
    await expect(deps.roleResolver('acc_officer_1')).resolves.toBeNull();
  });

  it('builds a working NIK crypto when a key is configured', () => {
    const deps = buildOfficerDeps({ ...baseConfig, nikEncryptionKey: TEST_NIK_KEY.toString('base64') });
    const cipher = deps.nikCrypto.encrypt('3171010101900001');
    // decrypt is synchronous (the use case awaits it, which also works on a plain value).
    expect(deps.nikCrypto.decrypt(cipher)).toBe('3171010101900001');
  });

  it('builds Postgres stores (lazy pool, no connection) when DATABASE_URL is set', () => {
    const deps = buildOfficerDeps({ ...baseConfig, databaseUrl: 'postgres://rusuh:secret@localhost:5432/rusuh' });
    // The pg Pool is lazy: constructing it must not open a connection, and the
    // stores must expose the TicketStore/AuditStore interface.
    expect(typeof deps.ticketStore.findByCodeOrId).toBe('function');
    expect(typeof deps.ticketStore.findEvent).toBe('function');
    expect(typeof deps.ticketStore.markUsed).toBe('function');
    expect(typeof deps.ticketStore.listByEvent).toBe('function');
    expect(typeof deps.auditStore.insert).toBe('function');
    expect(typeof deps.auditStore.list).toBe('function');
    expect(typeof deps.roleResolver).toBe('function');
  });
});
