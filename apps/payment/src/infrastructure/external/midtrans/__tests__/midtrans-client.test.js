const { createMidtransClient, formatMidtransTime } = require('../midtrans-client');

function mockFetch(handler) {
  return jest.fn(async (url, options) => handler(url, options));
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('formatMidtransTime', () => {
  it('formats a Date as WIB "YYYY-MM-DD HH:mm:ss +0700"', () => {
    expect(formatMidtransTime(new Date('2026-11-14T03:40:00.000Z'))).toBe('2026-11-14 10:40:00 +0700');
  });
});

describe('createMidtransClient', () => {
  it('throws without a serverKey', () => {
    expect(() => createMidtransClient({})).toThrow('requires a serverKey');
  });

  it('createSnap posts order_id, gross_amount, item_details, expiry (10 min from start_time)', async () => {
    const seen = [];
    const fetchImpl = mockFetch(async (url, options) => {
      seen.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
      return jsonResponse(201, {
        token: 'snap-token-1',
        redirect_url: 'https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-1'
      });
    });
    const client = createMidtransClient({ serverKey: 'sk-test', fetchImpl });
    const result = await client.createSnap({
      orderId: 'bk_01-1',
      grossAmount: 3015000,
      itemDetails: [
        { id: 'cat_festival_b', price: 1500000, quantity: 2, name: 'Festival B' },
        { id: 'admin_fee', price: 15000, quantity: 1, name: 'Biaya Admin' }
      ],
      customerDetails: { email: 'rina@example.id', first_name: 'Rina' },
      startTime: new Date('2026-11-14T03:40:00.000Z')
    });
    expect(result).toEqual({
      token: 'snap-token-1',
      redirectUrl: 'https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-1'
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://app.sandbox.midtrans.com/snap/v1/transactions');
    expect(seen[0].body.transaction_details).toEqual({ order_id: 'bk_01-1', gross_amount: 3015000 });
    expect(seen[0].body.expiry).toEqual({ start_time: '2026-11-14 10:40:00 +0700', unit: 'minutes', duration: 10 });
    expect(seen[0].body.enabled_payments).toEqual(['gopay', 'shopeepay', 'qris', 'indomaret', 'alfamart']);
    expect(seen[0].auth).toBe(`Basic ${Buffer.from('sk-test:', 'utf8').toString('base64')}`);
  });

  it('createSnap restricts enabled_payments to the requested method', async () => {
    const seen = [];
    const fetchImpl = mockFetch(async (url, options) => {
      seen.push(JSON.parse(options.body));
      return jsonResponse(201, { token: 't', redirect_url: 'https://example.invalid/r' });
    });
    const client = createMidtransClient({ serverKey: 'sk-test', fetchImpl });
    await client.createSnap({
      orderId: 'bk_01-1',
      grossAmount: 1000,
      itemDetails: [{ id: 'x', price: 1000, quantity: 1, name: 'X' }],
      startTime: new Date(),
      method: 'qris'
    });
    expect(seen[0].enabled_payments).toEqual(['qris']);
  });

  it('getStatus returns the Midtrans body and throws MidtransError on 404', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v2/bk_01-1/status'))
        return jsonResponse(200, { order_id: 'bk_01-1', transaction_status: 'settlement', gross_amount: '3015000.00' });
      return jsonResponse(404, { status_code: '404', status_message: 'Transaction not found' });
    });
    const client = createMidtransClient({ serverKey: 'sk-test', fetchImpl });
    const status = await client.getStatus('bk_01-1');
    expect(status.transaction_status).toBe('settlement');
    await expect(client.getStatus('bk_01-99')).rejects.toMatchObject({ name: 'MidtransError', status: 404 });
  });

  it('expire posts to /v2/{order_id}/expire and surfaces 412', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(412, { status_code: '412', status_message: 'Transaction has been already processed' })
    );
    const client = createMidtransClient({ serverKey: 'sk-test', fetchImpl });
    await expect(client.expire('bk_01-1')).rejects.toMatchObject({ name: 'MidtransError', status: 412 });
  });

  it('network failure throws MidtransError without a status', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error('socket hang up');
    });
    const client = createMidtransClient({ serverKey: 'sk-test', fetchImpl });
    await expect(client.getStatus('bk_01-1')).rejects.toMatchObject({ name: 'MidtransError', status: undefined });
  });
});
