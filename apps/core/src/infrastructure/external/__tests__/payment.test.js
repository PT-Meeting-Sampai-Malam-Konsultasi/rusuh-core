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
    await expect(client._call('/internal/snap', { method: 'POST' })).rejects.toThrow('stub mode');
  });

  it('createSnap posts to /internal/snap with the service key and returns the body', async () => {
    const fetchImpl = jest.fn(async () =>
      okJson({ orderId: 'bk_1-1', snapToken: 'tok_1', redirectUrl: 'https://x/1' })
    );
    const client = new PaymentClient({ baseUrl, serviceKey: 'svc-key', fetchImpl });
    const result = await client.createSnap({
      bookingId: 'bk_1',
      attempt: 1,
      orderId: 'bk_1-1',
      grossAmount: 1548300,
      itemDetails: [{ id: 'cat', price: 1500000, quantity: 1, name: 'Festival B' }]
    });
    expect(result).toEqual({ orderId: 'bk_1-1', snapToken: 'tok_1', redirectUrl: 'https://x/1' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8083/internal/snap',
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
    expect(url).toBe('http://localhost:8083/internal/snap');
    expect(init.headers).not.toHaveProperty('x-service-key');
  });

  it('getStatus returns the status body, and null on 404 (no transaction yet)', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/internal/status/bk_1-1')) {
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
      await client._call('/internal/status/bk_1-1');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toBe('Payment-module responded 503');
    expect(caught.status).toBe(503);
  });

  it('expire posts to /internal/expire, ignores 412, and rethrows other errors', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/internal/expire/bk_1-1')) return okJson({});
      if (url.endsWith('/internal/expire/bk_1-2')) return errJson(412);
      return errJson(500);
    });
    const client = new PaymentClient({ baseUrl, fetchImpl });
    await expect(client.expire('bk_1-1')).resolves.toBeUndefined();
    await expect(client.expire('bk_1-2')).resolves.toBeUndefined();
    await expect(client.expire('bk_1-3')).rejects.toThrow('responded 500');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
