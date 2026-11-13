const { createLogger, runWithRequestContext } = require('@rusuh/observability');
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

  it('forwards the canonical request ID without forwarding user headers', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { valid: true } }) }));
    const client = new DukcapilClient({ baseUrl: 'http://localhost:1', fetchImpl });
    await runWithRequestContext({ requestId: 'c3f21ea6-f0e7-44d4-a346-3a42fac5fa94' }, () =>
      client.verify('3171010101900001')
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:1/api/v1/verifications',
      expect.objectContaining({
        headers: { 'content-type': 'application/json', 'X-Request-ID': 'c3f21ea6-f0e7-44d4-a346-3a42fac5fa94' }
      })
    );
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

  it('logs a safe dependency.http.failed event on timeout without the NIK or URL', async () => {
    const lines = [];
    const logger = createLogger({ format: 'json', write: (line) => lines.push(JSON.parse(line)) });
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const client = new DukcapilClient({ baseUrl: 'http://dukcapil.internal', timeoutMs: 5, fetchImpl, logger });
    await expect(client.verify('3171010101900001')).rejects.toMatchObject({ code: 'DUKCAPIL_UNAVAILABLE' });
    expect(lines[0]).toMatchObject({
      event: 'dependency.http.failed',
      'upstream.service': 'dukcapil',
      'upstream.operation': 'verify',
      'upstream.failure_category': 'timeout'
    });
    expect(JSON.stringify(lines[0])).not.toMatch(/3171010101900001|dukcapil\.internal/);
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
