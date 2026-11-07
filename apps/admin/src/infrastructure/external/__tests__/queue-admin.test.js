const { createQueueClient } = require('../queue-admin');

describe('createQueueClient', () => {
  it('throws QUEUE_ADMIN_UNAVAILABLE (503) when the API is not configured', async () => {
    const client = createQueueClient({});
    let caught;
    try {
      await client.updateQueue('evt_1', { paused: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('QUEUE_ADMIN_UNAVAILABLE');
    expect(caught.status).toBe(503);
    expect(caught.message).toMatch('not configured');
  });

  it('PATCHes the queue endpoint and returns the parsed frontier', async () => {
    const calls = [];
    const fetchImpl = jest.fn(async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ paused: true, frontier: 42 }) };
    });
    const client = createQueueClient({
      baseUrl: 'https://admin.internal.rusuh.id/v1',
      operatorToken: 'op-token',
      fetchImpl
    });
    const result = await client.updateQueue('evt_1', { paused: true });
    expect(result).toEqual({ paused: true, frontier: 42 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe('https://admin.internal.rusuh.id/v1/admin/events/evt_1/queue');
    expect(calls[0].options.method).toBe('PATCH');
    expect(calls[0].options.headers['Content-Type']).toBe('application/json');
    expect(calls[0].options.headers.Authorization).toBe('Bearer op-token');
    expect(JSON.parse(calls[0].options.body)).toEqual({ paused: true });
  });

  it('omits the Authorization header when no operator token is configured', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const client = createQueueClient({ baseUrl: 'https://admin.internal.rusuh.id/v1', fetchImpl });
    await client.updateQueue('evt_1', { paused: false });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('URL-encodes the event id', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const client = createQueueClient({ baseUrl: 'https://admin.internal.rusuh.id/v1', fetchImpl });
    await client.updateQueue('evt 1/2', { paused: true });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://admin.internal.rusuh.id/v1/admin/events/evt%201%2F2/queue');
  });

  it('throws QUEUE_ADMIN_UNAVAILABLE (503) when the API returns a non-ok status', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const client = createQueueClient({ baseUrl: 'https://admin.internal.rusuh.id/v1', fetchImpl });
    let caught;
    try {
      await client.updateQueue('evt_1', { paused: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('QUEUE_ADMIN_UNAVAILABLE');
    expect(caught.status).toBe(503);
    expect(caught.message).toMatch('502');
  });
});
