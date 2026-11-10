const { DukcapilClient } = require('@/infrastructure/external/dukcapil');

describe('DukcapilClient', () => {
  it('returns the verdict from the mock (NIK-only)', async () => {
    const client = new DukcapilClient({
      baseUrl: 'http://localhost:1',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { nik: '3171010101900001', valid: true, reason: null } })
      })
    });
    await expect(client.verify('3171010101900001')).resolves.toEqual({
      valid: true,
      reason: null
    });
  });

  it('treats a valid:false verdict as a result, not an error', async () => {
    const client = new DukcapilClient({
      baseUrl: 'http://localhost:1',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { nik: '3171010101900009', valid: false, reason: 'NIK_NOT_FOUND' } })
      })
    });
    await expect(client.verify('3171010101900009')).resolves.toEqual({
      valid: false,
      reason: 'NIK_NOT_FOUND'
    });
  });

  it('treats a 400 as a malformed-NIK verdict (not an outage)', async () => {
    const client = new DukcapilClient({
      baseUrl: 'http://localhost:1',
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) })
    });
    await expect(client.verify('bad')).resolves.toEqual({ valid: false, reason: 'NIK_INVALID' });
  });

  it('opens the circuit after 3 consecutive failures (503 DUKCAPIL_UNAVAILABLE)', async () => {
    let calls = 0;
    const client = new DukcapilClient({
      baseUrl: 'http://localhost:1',
      fetchImpl: async () => {
        calls += 1;
        throw new Error('connect ECONNREFUSED');
      }
    });
    const attempt = () => client.verify('3171010101900001');
    await expect(attempt()).rejects.toMatchObject({ code: 'DUKCAPIL_UNAVAILABLE' });
    await expect(attempt()).rejects.toMatchObject({ code: 'DUKCAPIL_UNAVAILABLE' });
    await expect(attempt()).rejects.toMatchObject({ code: 'DUKCAPIL_UNAVAILABLE' });
    // Circuit open: the fetch is not called again.
    await expect(attempt()).rejects.toMatchObject({ code: 'DUKCAPIL_UNAVAILABLE' });
    expect(calls).toBe(3);
  });
});
