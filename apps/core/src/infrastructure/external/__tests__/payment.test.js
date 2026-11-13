const { runWithRequestContext } = require('@rusuh/observability');
const { PaymentClient } = require('@/infrastructure/external/payment');

function okJson(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function errJson(status) {
  return { ok: false, status, json: async () => ({}) };
}

describe('PaymentClient (LLD-03 internal client)', () => {
  const baseUrl = 'http://localhost:8083';

  it('isStub is true when baseUrl is not configured, and stub methods return fakes', async () => {
    const client = new PaymentClient({});
    expect(client.isStub).toBe(true);
    await expect(
      client.createSnap({ bookingId: 'bk_1', attempt: 1, orderId: 'bk_1-1', grossAmount: 100, itemDetails: [] })
    ).resolves.toEqual({
      orderId: 'bk_1-1',
      snapToken: 'stub-snap-bk_1-1',
      redirectUrl: 'https://pay.rusuh.id/start?order_id=bk_1-1'
    });
    await expect(client.getStatus('bk_1-1')).resolves.toEqual({
      status: 'pending',
      grossAmount: 0,
      transactionId: null,
      paymentType: null
    });
    await expect(client.expire('bk_1-1')).resolves.toBeUndefined();
  });

  it('_call throws in stub mode', async () => {
    const client = new PaymentClient({});
    await expect(client._call('/v1/internal/payments/snap', { method: 'POST' })).rejects.toThrow('stub mode');
  });

  it('createSnap posts to /v1/internal/payments/snap with the service key and returns the body', async () => {
    const fetchImpl = jest.fn(async () =>
      okJson({ orderId: 'bk_1-1', snapToken: 'tok_1', redirectUrl: 'https://x/1' })
    );
    const client = new PaymentClient({ baseUrl, serviceKey: 'svc-key', fetchImpl });
    const result = await client.createSnap({
      bookingId: 'bk_1',
      attempt: 1,
      orderId: 'bk_1-1',
      grossAmount: 1548300,
      itemDetails: [{ id: 'cat', price: 1500000, quantity: 1, name: 'Festival B' }],
      snapStartTime: '2026-11-14T03:40:00.000Z'
    });
    expect(result).toEqual({ orderId: 'bk_1-1', snapToken: 'tok_1', redirectUrl: 'https://x/1' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8083/v1/internal/payments/snap',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-service-key': 'svc-key', 'content-type': 'application/json' })
      })
    );
  });

  it('forwards the canonical request ID to the internal payment service', async () => {
    const fetchImpl = jest.fn(async () =>
      okJson({ orderId: 'bk_1-1', snapToken: 'tok_1', redirectUrl: 'https://x/1' })
    );
    const client = new PaymentClient({ baseUrl, fetchImpl });
    await runWithRequestContext({ requestId: 'c3f21ea6-f0e7-44d4-a346-3a42fac5fa94' }, () =>
      client.createSnap({ bookingId: 'bk_1', attempt: 1, orderId: 'bk_1-1', grossAmount: 100, itemDetails: [] })
    );
    expect(fetchImpl.mock.calls[0][1].headers['X-Request-ID']).toBe('c3f21ea6-f0e7-44d4-a346-3a42fac5fa94');
  });

  it('createSnap strips a trailing slash from baseUrl and omits the service key when unset', async () => {
    const fetchImpl = jest.fn(async () =>
      okJson({ orderId: 'bk_1-1', snapToken: 'tok_1', redirectUrl: 'https://x/1' })
    );
    const client = new PaymentClient({ baseUrl: 'http://localhost:8083/', fetchImpl });
    await client.createSnap({ bookingId: 'bk_1', attempt: 1, orderId: 'bk_1-1', grossAmount: 100, itemDetails: [] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8083/v1/internal/payments/snap');
    expect(init.headers).not.toHaveProperty('x-service-key');
  });

  it('getStatus returns the status body, and null on 404 (no transaction yet)', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/v1/internal/payments/orders/bk_1-1/status')) {
        return okJson({ status: 'settlement', grossAmount: 1548300, transactionId: 'txn_1', paymentType: 'gopay' });
      }
      return errJson(404);
    });
    const client = new PaymentClient({ baseUrl, fetchImpl });
    await expect(client.getStatus('bk_1-1')).resolves.toEqual({
      status: 'settlement',
      grossAmount: 1548300,
      transactionId: 'txn_1',
      paymentType: 'gopay'
    });
    await expect(client.getStatus('bk_1-2')).resolves.toBeNull();
  });

  it('getStatus rethrows a non-404 error', async () => {
    const client = new PaymentClient({ baseUrl, fetchImpl: async () => errJson(500) });
    await expect(client.getStatus('bk_1-1')).rejects.toThrow('responded 500');
  });

  it('_call throws on a non-2xx response, carrying the status', async () => {
    const client = new PaymentClient({ baseUrl, fetchImpl: async () => errJson(503) });
    let caught;
    try {
      await client._call('/v1/internal/payments/orders/bk_1-1/status');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toBe('Payment-module responded 503');
    expect(caught.status).toBe(503);
  });

  it('expire posts to /v1/internal/payments/orders/:id/expire, ignores 412, and rethrows other errors', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/v1/internal/payments/orders/bk_1-1/expire')) return okJson({});
      if (url.endsWith('/v1/internal/payments/orders/bk_1-2/expire')) return errJson(412);
      return errJson(500);
    });
    const client = new PaymentClient({ baseUrl, fetchImpl });
    await expect(client.expire('bk_1-1')).resolves.toBeUndefined();
    await expect(client.expire('bk_1-2')).resolves.toBeUndefined();
    await expect(client.expire('bk_1-3')).rejects.toThrow('responded 500');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  describe('failure logging', () => {
    const snapInput = {
      bookingId: 'bk_1',
      attempt: 1,
      orderId: 'bk_1-1',
      grossAmount: 100,
      itemDetails: [],
      snapStartTime: '2026-11-14T03:40:00.000Z'
    };

    it('logs a non-2xx createSnap with service, operation, category and status but no secrets', async () => {
      const logger = { warn: jest.fn() };
      const client = new PaymentClient({
        baseUrl,
        serviceKey: 'super-secret-key',
        fetchImpl: async () => errJson(404),
        logger
      });
      await runWithRequestContext({ requestId: 'req-123' }, () =>
        expect(client.createSnap(snapInput)).rejects.toMatchObject({ status: 404 })
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [event, fields] = logger.warn.mock.calls[0];
      expect(event).toBe('dependency.http.failed');
      expect(fields).toMatchObject({
        requestId: 'req-123',
        'upstream.service': 'payment',
        'upstream.operation': 'createSnap',
        'upstream.failure_category': 'unexpected_response',
        'upstream.status_code': 404
      });
      const serialized = JSON.stringify(fields);
      expect(serialized).not.toContain('super-secret-key');
      expect(serialized).not.toContain('localhost');
      expect(serialized).not.toContain('bk_1');
    });

    it('categorizes a connection failure', async () => {
      const logger = { warn: jest.fn() };
      const failure = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      const client = new PaymentClient({
        baseUrl,
        fetchImpl: async () => {
          throw failure;
        },
        logger
      });
      await expect(client.createSnap(snapInput)).rejects.toBe(failure);
      expect(logger.warn.mock.calls[0][1]).toMatchObject({ 'upstream.failure_category': 'connection' });
      expect(logger.warn.mock.calls[0][1]).not.toHaveProperty('upstream.status_code');
    });

    it('categorizes a client-side timeout', async () => {
      const logger = { warn: jest.fn() };
      const client = new PaymentClient({
        baseUrl,
        timeoutMs: 5,
        fetchImpl: (url, { signal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
        logger
      });
      await expect(client.createSnap(snapInput)).rejects.toThrow('aborted');
      expect(logger.warn.mock.calls[0][1]).toMatchObject({ 'upstream.failure_category': 'timeout' });
    });

    it('does not log the normal outcomes: status 404 and expire 412', async () => {
      const logger = { warn: jest.fn() };
      const fetchImpl = async (url) => (url.endsWith('/status') ? errJson(404) : errJson(412));
      const client = new PaymentClient({ baseUrl, fetchImpl, logger });
      await expect(client.getStatus('bk_1-1')).resolves.toBeNull();
      await expect(client.expire('bk_1-1')).resolves.toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs an unexpected status on getStatus and expire', async () => {
      const logger = { warn: jest.fn() };
      const client = new PaymentClient({ baseUrl, fetchImpl: async () => errJson(502), logger });
      await expect(client.getStatus('bk_1-1')).rejects.toMatchObject({ status: 502 });
      await expect(client.expire('bk_1-1')).rejects.toMatchObject({ status: 502 });
      expect(logger.warn.mock.calls.map(([, fields]) => fields['upstream.operation'])).toEqual(['getStatus', 'expire']);
    });

    it('never alters the thrown error when the logger itself throws', async () => {
      const logger = {
        warn: () => {
          throw new Error('logger broke');
        }
      };
      const client = new PaymentClient({ baseUrl, fetchImpl: async () => errJson(500), logger });
      await expect(client.createSnap(snapInput)).rejects.toMatchObject({
        message: 'Payment-module responded 500',
        status: 500
      });
    });
  });
});
