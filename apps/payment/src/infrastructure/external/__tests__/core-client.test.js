const { createCoreClient, CoreClientError } = require('../core-client');

function jsonResponse(status, body, jsonThrows = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jsonThrows
      ? async () => {
          throw new Error('invalid json');
        }
      : async () => body
  };
}

describe('createCoreClient', () => {
  it('requires a baseUrl', () => {
    expect(() => createCoreClient({})).toThrow('createCoreClient requires a baseUrl');
    expect(() => createCoreClient()).toThrow('createCoreClient requires a baseUrl');
  });

  const input = {
    bookingId: 'bk_01',
    orderId: 'bk_01-1',
    transactionId: 'tx-1',
    transactionStatus: 'settlement',
    paymentType: 'qris',
    grossAmount: 3015000
  };

  it('posts the camelCase body to the v1 internal path with x-service-key and returns handled', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { handled: true, booking: { status: 'PAID' } }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', credential: 'svc-secret', fetchImpl });
    const result = await client.notifyPaymentResult(input);
    expect(result).toEqual({
      handled: true,
      late: false,
      duplicate: false,
      reason: null,
      actionTaken: undefined
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8082/v1/internal/bookings/bk_01/payment-result');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['x-service-key']).toBe('svc-secret');
    expect(options.headers).not.toHaveProperty('X-Service-Credential');
    expect(JSON.parse(options.body)).toEqual({
      orderId: 'bk_01-1',
      transactionId: 'tx-1',
      transactionStatus: 'settlement',
      paymentType: 'qris',
      grossAmount: 3015000
    });
    expect(options.signal).toBeDefined();
  });

  it('does not return the booking body core sent back', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { handled: true, booking: { secret: 'x' } }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    const result = await client.notifyPaymentResult(input);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('maps late:true to actionTaken paid_after_expiry', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { handled: true, late: true }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    await expect(client.notifyPaymentResult(input)).resolves.toMatchObject({
      handled: true,
      late: true,
      actionTaken: 'paid_after_expiry'
    });
  });

  it('returns handled:false with the reason without throwing', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { handled: false, reason: 'not_held' }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    await expect(client.notifyPaymentResult(input)).resolves.toMatchObject({ handled: false, reason: 'not_held' });
  });

  it('omits the service key header when no credential is set', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { handled: true }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    await client.notifyPaymentResult(input);
    expect(fetchImpl.mock.calls[0][1].headers['x-service-key']).toBeUndefined();
  });

  it('encodes the bookingId in the path', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { handled: true }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    await client.notifyPaymentResult({ ...input, bookingId: 'bk/../x' });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:8082/v1/internal/bookings/bk%2F..%2Fx/payment-result');
  });

  it.each([401, 404, 422, 500])('throws CoreClientError with status %i on a non-OK response', async (status) => {
    const fetchImpl = jest.fn(async () => jsonResponse(status, { error: 'boom' }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    const caught = await client.notifyPaymentResult(input).catch((error) => error);
    expect(caught).toBeInstanceOf(CoreClientError);
    expect(caught.status).toBe(status);
    expect(caught.message).toBe(`Core notify responded ${status}`);
    expect(caught.name).toBe('CoreClientError');
  });

  it('throws CoreClientError when fetch itself fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    await expect(client.notifyPaymentResult(input)).rejects.toMatchObject({
      name: 'CoreClientError',
      message: 'Core notify failed: connection refused'
    });
  });

  it.each([
    ['a non-JSON body', () => jsonResponse(200, null, true)],
    ['an empty object', () => jsonResponse(200, {})],
    ['a body without a boolean handled', () => jsonResponse(200, { handled: 'yes' })]
  ])('treats 200 with %s as a failure so it is retried', async (_name, makeResponse) => {
    const fetchImpl = jest.fn(async () => makeResponse());
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    await expect(client.notifyPaymentResult(input)).rejects.toMatchObject({
      name: 'CoreClientError',
      message: 'Core notify returned an unreadable body'
    });
  });
});
