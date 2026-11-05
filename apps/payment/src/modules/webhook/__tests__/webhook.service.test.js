const { notification, buildHarness, ORDER_ID, BOOKING_ID } = require('../webhook-test-harness');
const { parseBookingId, amountEquals, mapOrderStatus, isFinalSuccess } = require('../webhook.service');

describe('webhook pipeline (LLD-03 §5.1)', () => {
  it('settlement: verifies signature, confirms via Get Status, notifies core, returns 200', async () => {
    const { store, service, statusService, coreClient, metrics } = await buildHarness();
    const result = await service.processNotification(notification());
    expect(result).toEqual({ outcome: 'settled', httpStatus: 200 });
    expect(statusService.confirmViaGetStatus).toHaveBeenCalledWith(ORDER_ID);
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      orderId: ORDER_ID,
      transactionId: 'tx-1',
      transactionStatus: 'settlement',
      paymentType: 'qris',
      grossAmount: 3015000
    });
    const attempt = await store.findPaymentAttempt('tx-1');
    expect(attempt.confirmed).toBe(true);
    expect(attempt.transactionStatus).toBe('settlement');
    const order = await store.getPaymentOrder(ORDER_ID);
    expect(order.status).toBe('settled');
    expect(metrics.increment).toHaveBeenCalledWith('webhook_valid');
  });

  it('invalid signature: 200, no state change, no Get Status, no core call', async () => {
    const { store, service, statusService, coreClient, metrics } = await buildHarness();
    const body = notification();
    body.signature_key = '0'.repeat(128);
    const result = await service.processNotification(body);
    expect(result).toEqual({ outcome: 'invalid_signature', httpStatus: 200 });
    expect(statusService.confirmViaGetStatus).not.toHaveBeenCalled();
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
    expect(await store.findPaymentAttempt('tx-1')).toBeNull();
    const logs = await store.getCallbackLogs({ orderId: ORDER_ID });
    expect(logs).toHaveLength(1);
    expect(logs[0].signatureValid).toBe(false);
    expect(metrics.increment).toHaveBeenCalledWith('webhook_invalid');
  });

  it('malformed payload: 200, recorded as invalid', async () => {
    const { service, statusService } = await buildHarness();
    const result = await service.processNotification({ order_id: ORDER_ID });
    expect(result).toEqual({ outcome: 'invalid_payload', httpStatus: 200 });
    expect(statusService.confirmViaGetStatus).not.toHaveBeenCalled();
  });

  it('duplicate (same transaction + same status + confirmed): 200, no core call', async () => {
    const { service, coreClient } = await buildHarness();
    await service.processNotification(notification());
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
    const second = await service.processNotification(notification());
    expect(second).toEqual({ outcome: 'duplicate', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });

  it('progression (pending -> settlement): the same transaction is processed again', async () => {
    const { service, coreClient, statusService } = await buildHarness({
      getStatusImpl: async (orderId) => ({
        orderId,
        transactionId: 'tx-1',
        transactionStatus: 'pending',
        fraudStatus: null,
        paymentType: 'qris',
        grossAmount: '3015000.00',
        statusCode: '201',
        currency: 'IDR'
      })
    });
    const pending = await service.processNotification(
      notification({ transaction_status: 'pending', status_code: '201' })
    );
    expect(pending).toEqual({ outcome: 'recorded', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();

    statusService.confirmViaGetStatus.mockImplementation(async (orderId) => ({
      orderId,
      transactionId: 'tx-1',
      transactionStatus: 'settlement',
      fraudStatus: 'accept',
      paymentType: 'qris',
      grossAmount: '3015000.00',
      statusCode: '200',
      currency: 'IDR'
    }));
    const settled = await service.processNotification(notification());
    expect(settled).toEqual({ outcome: 'settled', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });

  it('unconfirmed retry (same status, confirmed=false): processed again, not a duplicate', async () => {
    const { service, statusService, coreClient } = await buildHarness();
    statusService.confirmViaGetStatus.mockRejectedValueOnce(
      Object.assign(new Error('Get Status failed'), { code: 'GET_STATUS_UNCONFIRMED' })
    );
    const first = await service.processNotification(notification());
    expect(first).toEqual({ outcome: 'unconfirmed', httpStatus: 500 });
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();

    const second = await service.processNotification(notification());
    expect(second).toEqual({ outcome: 'settled', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });

  it('amount mismatch (webhook and Get Status): 200, no transition, no core call', async () => {
    const { service, coreClient, metrics } = await buildHarness();
    const result = await service.processNotification(notification({ gross_amount: '999.00' }));
    expect(result).toEqual({ outcome: 'amount_mismatch', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
    expect(metrics.increment).toHaveBeenCalledWith('amount_mismatch_count');
  });

  it('Get Status amount mismatch (payload ok, Get Status differs): 200, no core call', async () => {
    const { service, coreClient } = await buildHarness({
      getStatusImpl: async (orderId) => ({
        orderId,
        transactionId: 'tx-1',
        transactionStatus: 'settlement',
        fraudStatus: 'accept',
        paymentType: 'qris',
        grossAmount: '999.00',
        statusCode: '200',
        currency: 'IDR'
      })
    });
    const result = await service.processNotification(notification());
    expect(result).toEqual({ outcome: 'amount_mismatch', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
  });

  it('Get Status failure after retries: 500 (Midtrans retries once)', async () => {
    const { service: failingService, coreClient } = await buildHarness({
      getStatusImpl: async () => {
        throw Object.assign(new Error('Get Status failed'), { code: 'GET_STATUS_UNCONFIRMED' });
      }
    });
    const result = await failingService.processNotification(notification());
    expect(result).toEqual({ outcome: 'unconfirmed', httpStatus: 500 });
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
  });

  it('Get Status 404 after a valid webhook: 200, anomaly, no state change', async () => {
    const { service, coreClient } = await buildHarness({
      getStatusImpl: async () => {
        throw Object.assign(new Error('Get Status 404'), { code: 'GET_STATUS_NOT_FOUND' });
      }
    });
    const result = await service.processNotification(notification());
    expect(result).toEqual({ outcome: 'get_status_not_found', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
  });

  it('unknown order: 200, no state change', async () => {
    const { service, coreClient } = await buildHarness();
    const body = notification({ order_id: 'bk_99-1' });
    const result = await service.processNotification(body);
    expect(result).toEqual({ outcome: 'unknown_order', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
  });

  it('capture with fraud deny: recorded only, no core call (failed attempt, not failed booking)', async () => {
    const { service, coreClient } = await buildHarness({
      getStatusImpl: async (orderId) => ({
        orderId,
        transactionId: 'tx-1',
        transactionStatus: 'capture',
        fraudStatus: 'deny',
        paymentType: 'qris',
        grossAmount: '3015000.00',
        statusCode: '200',
        currency: 'IDR'
      })
    });
    const result = await service.processNotification(notification({ transaction_status: 'capture' }));
    expect(result).toEqual({ outcome: 'recorded', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
  });

  it('capture with fraud accept: notifies core (ADR-0008)', async () => {
    const { service, coreClient } = await buildHarness({
      getStatusImpl: async (orderId) => ({
        orderId,
        transactionId: 'tx-1',
        transactionStatus: 'capture',
        fraudStatus: 'accept',
        paymentType: 'qris',
        grossAmount: '3015000.00',
        statusCode: '200',
        currency: 'IDR'
      })
    });
    const result = await service.processNotification(notification({ transaction_status: 'capture' }));
    expect(result).toEqual({ outcome: 'settled', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'deny', 'cancel', 'failure'])(
    '%s: recorded only, booking stays PAYMENT_PENDING',
    async (status) => {
      const { service, coreClient, store } = await buildHarness({
        getStatusImpl: async (orderId) => ({
          orderId,
          transactionId: `tx-${status}`,
          transactionStatus: status,
          fraudStatus: null,
          paymentType: 'qris',
          grossAmount: '3015000.00',
          statusCode: '200',
          currency: 'IDR'
        })
      });
      const result = await service.processNotification(
        notification({ transaction_status: status, transaction_id: `tx-${status}` })
      );
      expect(result).toEqual({ outcome: 'recorded', httpStatus: 200 });
      expect(coreClient.notifyPaymentResult).not.toHaveBeenCalled();
      const order = await store.getPaymentOrder(ORDER_ID);
      expect(['pending', 'failed'].includes(order.status)).toBe(true);
    }
  );

  it('expire: notifies core (timeout path)', async () => {
    const { service, coreClient } = await buildHarness({
      getStatusImpl: async (orderId) => ({
        orderId,
        transactionId: 'tx-1',
        transactionStatus: 'expire',
        fraudStatus: null,
        paymentType: 'qris',
        grossAmount: '3015000.00',
        statusCode: '200',
        currency: 'IDR'
      })
    });
    const result = await service.processNotification(
      notification({ transaction_status: 'expire', status_code: '200' })
    );
    expect(result).toEqual({ outcome: 'expired', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });

  it('expire + core failure: 500 + metric', async () => {
    const { service, coreClient, metrics } = await buildHarness({
      getStatusImpl: async (orderId) => ({
        orderId,
        transactionId: 'tx-1',
        transactionStatus: 'expire',
        fraudStatus: null,
        paymentType: 'qris',
        grossAmount: '3015000.00',
        statusCode: '200',
        currency: 'IDR'
      }),
      coreImpl: async () => {
        throw new Error('core unreachable');
      }
    });
    const result = await service.processNotification(
      notification({ transaction_status: 'expire', status_code: '200' })
    );
    expect(result).toEqual({ outcome: 'core_callback_failed', httpStatus: 500 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(3);
    expect(metrics.increment).toHaveBeenCalledWith('core_callback_failures');
  });

  it('late settlement (booking already EXPIRED): PAID_AFTER_EXPIRY, 200, no resurrect', async () => {
    const { service, coreClient } = await buildHarness({
      coreImpl: async () => ({ bookingStatus: 'EXPIRED', actionTaken: 'paid_after_expiry' })
    });
    const result = await service.processNotification(notification());
    expect(result).toEqual({ outcome: 'paid_after_expiry', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });

  it('core callback failure after retries: 500 + metric', async () => {
    const { service, coreClient, metrics } = await buildHarness({
      coreImpl: async () => {
        throw new Error('core unreachable');
      }
    });
    const result = await service.processNotification(notification());
    expect(result).toEqual({ outcome: 'core_callback_failed', httpStatus: 500 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(3);
    expect(metrics.increment).toHaveBeenCalledWith('core_callback_failures');
  });

  it('Get Status status wins over the webhook payload status', async () => {
    const { service, coreClient } = await buildHarness({
      getStatusImpl: async (orderId) => ({
        orderId,
        transactionId: 'tx-1',
        transactionStatus: 'settlement',
        fraudStatus: 'accept',
        paymentType: 'qris',
        grossAmount: '3015000.00',
        statusCode: '200',
        currency: 'IDR'
      })
    });
    // Webhook says pending; Get Status says settlement -> settlement wins.
    const result = await service.processNotification(
      notification({ transaction_status: 'pending', status_code: '201' })
    );
    expect(result).toEqual({ outcome: 'settled', httpStatus: 200 });
    expect(coreClient.notifyPaymentResult).toHaveBeenCalledTimes(1);
  });
});

describe('webhook helpers', () => {
  it('parseBookingId splits on the last hyphen', () => {
    expect(parseBookingId('bk_01JB2Y6Z8Q-3')).toBe('bk_01JB2Y6Z8Q');
    expect(parseBookingId('nohyphen')).toBeNull();
    expect(parseBookingId(null)).toBeNull();
  });

  it('amountEquals compares the Midtrans string with the server integer', () => {
    expect(amountEquals('3015000.00', 3015000)).toBe(true);
    expect(amountEquals('3015000', 3015000)).toBe(true);
    expect(amountEquals('3015000.01', 3015000)).toBe(false);
    expect(amountEquals('abc', 3015000)).toBe(false);
  });

  it('mapOrderStatus maps confirmed statuses', () => {
    expect(mapOrderStatus('settlement')).toBe('settled');
    expect(mapOrderStatus('capture')).toBe('settled');
    expect(mapOrderStatus('expire')).toBe('expired');
    expect(mapOrderStatus('deny')).toBe('failed');
    expect(mapOrderStatus('pending')).toBe('pending');
  });

  it('isFinalSuccess requires fraud accept for capture', () => {
    expect(isFinalSuccess('settlement', null)).toBe(true);
    expect(isFinalSuccess('capture', 'accept')).toBe(true);
    expect(isFinalSuccess('capture', null)).toBe(true);
    expect(isFinalSuccess('capture', 'deny')).toBe(false);
    expect(isFinalSuccess('capture', 'challenge')).toBe(false);
    expect(isFinalSuccess('pending', null)).toBe(false);
  });
});
