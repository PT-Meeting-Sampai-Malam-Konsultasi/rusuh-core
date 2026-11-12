const { createAuthAccountsClient } = require('@/infrastructure/external/auth-accounts');
const { createRequireAdmin } = require('@/presentation/http/middleware/require-admin');

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

describe('createAuthAccountsClient', () => {
  it('calls the auth internal endpoint with the service key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ id: 'acc_1', role: 'admin' }));
    const client = createAuthAccountsClient({ baseUrl: 'http://auth:8081/', serviceKey: 'k', fetchImpl });
    expect(await client.getAccount('acc_1')).toEqual({ id: 'acc_1', role: 'admin' });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://auth:8081/v1/internal/accounts/acc_1');
    expect(fetchImpl.mock.calls[0][1].headers['x-service-key']).toBe('k');
  });

  it('returns null when the account does not exist', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const client = createAuthAccountsClient({ baseUrl: 'http://auth', fetchImpl });
    expect(await client.getAccount('acc_x')).toBeNull();
  });

  it('fails closed with SERVICE_UNAVAILABLE when auth errors, is unreachable, or is unconfigured', async () => {
    const failing = createAuthAccountsClient({
      baseUrl: 'http://auth',
      fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 500 })
    });
    await expect(failing.getAccount('a')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    const down = createAuthAccountsClient({
      baseUrl: 'http://auth',
      fetchImpl: jest.fn().mockRejectedValue(new Error('x'))
    });
    await expect(down.getAccount('a')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await expect(createAuthAccountsClient({}).getAccount('a')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('requireAdmin with the auth role', () => {
  const run = async (role) => {
    const middleware = createRequireAdmin({
      auth: { verify: async () => ({ sub: 'acc_1' }) },
      accounts: { getAccount: async () => (role ? { id: 'acc_1', email: 'a@x.id', role } : null) }
    });
    const request = { headers: { authorization: 'Bearer t' } };
    return new Promise((resolve) => {
      middleware(request, {}, (error) => resolve({ error, request }));
    });
  };

  it('admits an admin account', async () => {
    const { error, request } = await run('admin');
    expect(error).toBeUndefined();
    expect(request.admin).toMatchObject({ accountId: 'acc_1', role: 'admin' });
  });

  it('rejects user, officer and unknown accounts with FORBIDDEN', async () => {
    expect((await run('user')).error.code).toBe('FORBIDDEN');
    expect((await run('officer')).error.code).toBe('FORBIDDEN');
    expect((await run(null)).error.code).toBe('FORBIDDEN');
  });
});
