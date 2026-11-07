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

  it('notifies core and returns bookingStatus + actionTaken', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { booking_status: 'paid', action_taken: 'paid' }));
    const client = createCoreClient({
      baseUrl: 'http://localhost:8082',
      credential: 'svc-secret',
      fetchImpl
    });
    const result = await client.notifyPaymentResult({
      bookingId: 'bk_01',
      orderId: 'bk_01-1',
      transactionId: 'tx-1',
      transactionStatus: 'settlement',
      paymentType: 'qris',
      grossAmount: 3015000
    });
    expect(result).toEqual({
      bookingStatus: 'paid',
      actionTaken: 'paid',
      raw: { booking_status: 'paid', action_taken: 'paid' }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8082/internal/payments/notify');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers.Accept).toBe('application/json');
    expect(options.headers['X-Service-Credential']).toBe('svc-secret');
    expect(JSON.parse(options.body)).toEqual({
      booking_id: 'bk_01',
      order_id: 'bk_01-1',
      transaction_id: 'tx-1',
      transaction_status: 'settlement',
      payment_type: 'qris',
      gross_amount: 3015000
    });
    expect(options.signal).toBeDefined();
  });

  it('omits the service-credential header when no credential is set', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { booking_status: 'paid' }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    await client.notifyPaymentResult({
      bookingId: 'bk_01',
      orderId: 'bk_01-1',
      transactionId: 'tx-1',
      transactionStatus: 'settlement',
      grossAmount: 3015000
    });
    expect(fetchImpl.mock.calls[0][1].headers['X-Service-Credential']).toBeUndefined();
  });

  it('throws CoreClientError with the status on a non-OK response', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(500, { error: 'boom' }));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    let caught;
    try {
      await client.notifyPaymentResult({
        bookingId: 'bk_01',
        orderId: 'bk_01-1',
        transactionId: 'tx-1',
        transactionStatus: 'settlement',
        grossAmount: 3015000
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CoreClientError);
    expect(caught.status).toBe(500);
    expect(caught.message).toBe('Core notify responded 500');
    expect(caught.name).toBe('CoreClientError');
  });

  it('throws CoreClientError when fetch itself fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    await expect(
      client.notifyPaymentResult({
        bookingId: 'bk_01',
        orderId: 'bk_01-1',
        transactionId: 'tx-1',
        transactionStatus: 'settlement',
        grossAmount: 3015000
      })
    ).rejects.toMatchObject({ name: 'CoreClientError', message: 'Core notify failed: connection refused' });
  });

  it('returns null fields when the response body is not JSON but the status is OK', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, null, true));
    const client = createCoreClient({ baseUrl: 'http://localhost:8082', fetchImpl });
    const result = await client.notifyPaymentResult({
      bookingId: 'bk_01',
      orderId: 'bk_01-1',
      transactionId: 'tx-1',
      transactionStatus: 'settlement',
      grossAmount: 3015000
    });
    expect(result).toEqual({ bookingStatus: undefined, actionTaken: undefined, raw: null });
  });
});
