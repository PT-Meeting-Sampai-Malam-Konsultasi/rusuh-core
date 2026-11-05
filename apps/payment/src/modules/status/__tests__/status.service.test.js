const { createMidtransClient, MidtransError } = require('@/infrastructure/midtrans/midtrans-client');
const { createStatusService } = require('../status.service');

function mockFetch(handler) {
  return jest.fn(async (url, options) => handler(url, options));
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function buildService({ fetchImpl, getStatusMaxRetries = 3 } = {}) {
  const midtransClient = createMidtransClient({ serverKey: 'sk-test', fetchImpl });
  const metrics = { increment: jest.fn() };
  const service = createStatusService({
    midtransClient,
    metrics,
    logger: undefined,
    getStatusMaxRetries,
    getStatusRetryBaseMs: 0,
    sleep: async () => {}
  });
  return { service, metrics, fetchImpl };
}

describe('confirmViaGetStatus', () => {
  it('returns the confirmed Get Status values', async () => {
    const fetchImpl = mockFetch(async (url) => {
      expect(url).toBe('https://api.sandbox.midtrans.com/v2/bk_01-1/status');
      return jsonResponse(200, {
        order_id: 'bk_01-1',
        transaction_id: 'tx-1',
        transaction_status: 'settlement',
        fraud_status: 'accept',
        payment_type: 'qris',
        gross_amount: '3015000.00',
        status_code: '200',
        currency: 'IDR'
      });
    });
    const { service, metrics } = buildService({ fetchImpl });
    const result = await service.confirmViaGetStatus('bk_01-1');
    expect(result).toMatchObject({
      orderId: 'bk_01-1',
      transactionId: 'tx-1',
      transactionStatus: 'settlement',
      fraudStatus: 'accept',
      paymentType: 'qris',
      grossAmount: '3015000.00'
    });
    expect(metrics.increment).toHaveBeenCalledWith('get_status_calls');
  });

  it('retries on 5xx and succeeds on the third attempt', async () => {
    let calls = 0;
    const fetchImpl = mockFetch(async () => {
      calls += 1;
      if (calls < 3) return jsonResponse(500, { status_code: '500' });
      return jsonResponse(200, {
        order_id: 'bk_01-1',
        transaction_id: 'tx-1',
        transaction_status: 'settlement',
        gross_amount: '3015000.00',
        status_code: '200'
      });
    });
    const { service, metrics } = buildService({ fetchImpl });
    const result = await service.confirmViaGetStatus('bk_01-1');
    expect(result.transactionStatus).toBe('settlement');
    expect(calls).toBe(3);
    expect(metrics.increment).toHaveBeenCalledWith('midtrans_5xx_count');
  });

  it('throws GET_STATUS_NOT_FOUND on 404 (no retry)', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(404, { status_code: '404', status_message: 'Transaction not found' })
    );
    const { service } = buildService({ fetchImpl });
    await expect(service.confirmViaGetStatus('bk_01-99')).rejects.toMatchObject({ code: 'GET_STATUS_NOT_FOUND' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws GET_STATUS_UNCONFIRMED after the retries are exhausted', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(500, { status_code: '500' }));
    const { service } = buildService({ fetchImpl });
    await expect(service.confirmViaGetStatus('bk_01-1')).rejects.toMatchObject({ code: 'GET_STATUS_UNCONFIRMED' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('expireOrder', () => {
  it('returns ok on success', async () => {
    const fetchImpl = mockFetch(async (url) => {
      expect(url).toBe('https://api.sandbox.midtrans.com/v2/bk_01-1/expire');
      return jsonResponse(200, { status_code: '200', status_message: 'Success, transaction is expired' });
    });
    const { service } = buildService({ fetchImpl });
    await expect(service.expireOrder('bk_01-1')).resolves.toEqual({ ok: true, orderId: 'bk_01-1' });
  });

  it('treats 412 as ok (already expired/settled)', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(412, { status_code: '412' }));
    const { service } = buildService({ fetchImpl });
    await expect(service.expireOrder('bk_01-1')).resolves.toEqual({
      ok: true,
      orderId: 'bk_01-1',
      alreadySettledOrExpired: true
    });
  });

  it('returns ok:false (never throws) on 5xx so the sweeper keeps going', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(500, { status_code: '500' }));
    const { service } = buildService({ fetchImpl });
    const result = await service.expireOrder('bk_01-1');
    expect(result.ok).toBe(false);
    expect(result.orderId).toBe('bk_01-1');
  });

  it('MidtransError is the client error type', () => {
    expect(new MidtransError('x', 404).status).toBe(404);
  });
});
