const { MemoryStock } = require('@/infrastructure/cache/stock');
const { createRequireAccountOrAdmission } = require('../auth');

const ADMISSION_TOKEN = 'adm_test01JB2Y5W3N8Qm4sT7vY2xK9pL';

async function seedAdmission(stock, userId = 'acc_01', eventId = 'evt_2026_gbk') {
  await stock.setAdmission(
    ADMISSION_TOKEN,
    {
      user_id: userId,
      event_id: eventId,
      slot_id: 's_1',
      max_tickets: 3,
      expires_at: new Date(Date.now() + 600000).toISOString()
    },
    16 * 60 * 1000
  );
}

function makeRequest({ bearer = null, admission = null } = {}) {
  const headers = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (admission) headers['x-admission-token'] = admission;
  return { headers, params: {}, body: {} };
}

function runMiddleware(middleware, request) {
  return new Promise((resolve) => {
    middleware(request, {}, (error) => resolve({ error, request }));
  });
}

describe('createRequireAccountOrAdmission (LLD-02 §4, either-or auth)', () => {
  it('accepts an admission token alone (no Bearer) via tryAdmission', async () => {
    const stock = new MemoryStock();
    await seedAdmission(stock);
    const verify = async () => {
      throw new Error('should not be called');
    };
    const middleware = createRequireAccountOrAdmission({ verify, stock, retryMs: 10, retryIntervalMs: 5 });
    const { error, request } = await runMiddleware(middleware, makeRequest({ admission: ADMISSION_TOKEN }));
    expect(error).toBeFalsy();
    expect(request.admission).toMatchObject({ token: ADMISSION_TOKEN, userId: 'acc_01', eventId: 'evt_2026_gbk' });
  });

  it('falls back to the admission token when the account token fails', async () => {
    const stock = new MemoryStock();
    await seedAdmission(stock);
    const verify = async () => {
      const error = new Error('bad signature');
      error.code = 'UNAUTHORIZED';
      throw error;
    };
    const middleware = createRequireAccountOrAdmission({ verify, stock, retryMs: 10, retryIntervalMs: 5 });
    const { error, request } = await runMiddleware(
      middleware,
      makeRequest({ bearer: 'bad-token', admission: ADMISSION_TOKEN })
    );
    expect(error).toBeFalsy();
    expect(request.admission).toMatchObject({ token: ADMISSION_TOKEN });
  });

  it('rejects when the account fails and there is no admission token', async () => {
    const stock = new MemoryStock();
    const verify = async () => {
      const error = new Error('bad signature');
      error.code = 'UNAUTHORIZED';
      throw error;
    };
    const middleware = createRequireAccountOrAdmission({ verify, stock, retryMs: 10, retryIntervalMs: 5 });
    const { error } = await runMiddleware(middleware, makeRequest({ bearer: 'bad-token' }));
    expect(error).toBeDefined();
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('rejects when neither a Bearer nor an admission token is present', async () => {
    const stock = new MemoryStock();
    const verify = async () => ({ sub: 'acc_01', jti: 'jti-1', exp: 9999999999, iat: 1000000000 });
    const middleware = createRequireAccountOrAdmission({ verify, stock, retryMs: 10, retryIntervalMs: 5 });
    const { error } = await runMiddleware(middleware, makeRequest());
    expect(error).toBeDefined();
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('accepts a good account and attaches a valid admission when present', async () => {
    const stock = new MemoryStock();
    await seedAdmission(stock);
    const verify = async () => ({ sub: 'acc_01', jti: 'jti-1', exp: 9999999999, iat: 1000000000 });
    const middleware = createRequireAccountOrAdmission({ verify, stock, retryMs: 10, retryIntervalMs: 5 });
    const { error, request } = await runMiddleware(
      middleware,
      makeRequest({ bearer: 'good-token', admission: ADMISSION_TOKEN })
    );
    expect(error).toBeFalsy();
    expect(request.account.sub).toBe('acc_01');
    expect(request.admission).toMatchObject({ token: ADMISSION_TOKEN });
  });

  it('a bad admission does not revoke a good account (admission is ignored)', async () => {
    const stock = new MemoryStock();
    const verify = async () => ({ sub: 'acc_01', jti: 'jti-1', exp: 9999999999, iat: 1000000000 });
    const middleware = createRequireAccountOrAdmission({ verify, stock, retryMs: 10, retryIntervalMs: 5 });
    const { error, request } = await runMiddleware(
      middleware,
      makeRequest({ bearer: 'good-token', admission: 'adm_invalid' })
    );
    expect(error).toBeFalsy();
    expect(request.account.sub).toBe('acc_01');
    expect(request.admission).toBeUndefined();
  });
});
