const { verifySignatureKey } = require('@/domain/signature');
const { parseBookingId, amountEquals, mapOrderStatus, isFinalSuccess } = require('@/domain/payment');

/**
 * Creates the webhook use case (LLD-03 §5.1, eight validation steps).
 * The ONLY public endpoint of this module. Every webhook is confirmed via
 * Get Status before any state change (ADR-0008); the payload is never trusted
 * alone. Invalid signature / amount mismatch / unknown order -> 200, no state
 * change. Unconfirmed Get Status -> 500 (Midtrans retries once).
 *
 * Depends only on the domain ports (store, status use case, core client) —
 * the adapters are injected by the container, never required here.
 */
function createWebhookUseCase({
  store,
  statusUseCase,
  coreClient,
  serverKey,
  metrics,
  logger,
  coreNotifyMaxRetries = 3,
  coreNotifyRetryBaseMs = 200,
  sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    })
} = {}) {
  if (!store) throw new Error('createWebhookUseCase requires a store');
  if (!statusUseCase) throw new Error('createWebhookUseCase requires a statusUseCase');
  if (!coreClient) throw new Error('createWebhookUseCase requires a coreClient');
  if (!serverKey) throw new Error('createWebhookUseCase requires a serverKey');

  async function notifyCore(input) {
    let lastError = null;
    for (let attempt = 1; attempt <= coreNotifyMaxRetries; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential retry with backoff must await in order
        return await coreClient.notifyPaymentResult(input);
      } catch (error) {
        lastError = error;
        if (attempt < coreNotifyMaxRetries) {
          // eslint-disable-next-line no-await-in-loop -- sequential retry with backoff must await in order
          await sleep(coreNotifyRetryBaseMs * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError;
  }

  return {
    /**
     * Processes one Midtrans HTTP notification through the eight steps.
     *
     * @param {object} payload - Parsed webhook JSON body.
     * @returns {Promise<object>} { outcome, httpStatus }.
     */
    async processNotification(payload) {
      metrics?.increment?.('webhook_received');
      const log = (tags, data, message, level = 'info') => {
        logger?.addTags?.(tags)?.addData?.(data)?.[level]?.(message);
      };

      // Step 3: payload must be a well-formed notification object.
      const notification = payload && typeof payload === 'object' ? payload : null;
      const {
        order_id: orderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        signature_key: signatureKey,
        transaction_status: transactionStatus,
        transaction_id: transactionId,
        payment_type: paymentType
      } = notification || {};
      if (
        !notification ||
        !orderId ||
        !statusCode ||
        !grossAmount ||
        !signatureKey ||
        !transactionStatus ||
        !transactionId
      ) {
        await store.createCallbackLog({
          orderId: orderId || null,
          bookingId: parseBookingId(orderId),
          signatureValid: false,
          transactionStatus: transactionStatus || null
        });
        metrics?.increment?.('webhook_invalid');
        return { outcome: 'invalid_payload', httpStatus: 200 };
      }
      const bookingId = parseBookingId(orderId);

      // Step 4: verify signature FIRST, before any state change (Q45).
      const signatureValid = verifySignatureKey({ orderId, statusCode, grossAmount, serverKey, signatureKey });
      await store.createCallbackLog({ orderId, bookingId, signatureValid, transactionStatus });
      if (!signatureValid) {
        metrics?.increment?.('webhook_invalid');
        log(['webhook', 'invalid-signature'], { orderId, bookingId }, 'Webhook signature invalid', 'error');
        return { outcome: 'invalid_signature', httpStatus: 200 };
      }
      metrics?.increment?.('webhook_valid');

      // Step 5: dedup by transaction_id (UNIQUE + confirmed flag).
      const existing = await store.findPaymentAttempt(transactionId);
      if (existing && existing.transactionStatus === transactionStatus && existing.confirmed) {
        return { outcome: 'duplicate', httpStatus: 200 };
      }
      if (!existing) {
        await store.createPaymentAttempt({
          orderId,
          bookingId,
          transactionId,
          transactionStatus,
          paymentType,
          grossAmount: Number(grossAmount),
          confirmed: false,
          rawPayload: payload
        });
      }

      // Step 6: amount pre-check against the server total.
      const order = await store.getPaymentOrder(orderId);
      if (!order) {
        log(['webhook', 'unknown-order'], { orderId, bookingId }, 'Webhook for an unknown order', 'error');
        return { outcome: 'unknown_order', httpStatus: 200 };
      }
      if (!amountEquals(grossAmount, order.grossAmount)) {
        metrics?.increment?.('amount_mismatch_count');
        log(
          ['webhook', 'amount-mismatch'],
          { orderId, bookingId, grossAmount, serverTotal: order.grossAmount },
          'Webhook amount mismatch',
          'error'
        );
        return { outcome: 'amount_mismatch', httpStatus: 200 };
      }

      // Step 7: confirm via Get Status (authoritative; never trust the payload).
      let confirmed;
      try {
        confirmed = await statusUseCase.confirmViaGetStatus(orderId);
      } catch (error) {
        metrics?.increment?.('webhook_unconfirmed');
        if (error.code === 'GET_STATUS_NOT_FOUND') {
          log(
            ['webhook', 'get-status-404'],
            { orderId, bookingId },
            'Get Status 404 after a valid webhook (anomaly)',
            'error'
          );
          return { outcome: 'get_status_not_found', httpStatus: 200 };
        }
        log(
          ['webhook', 'get-status-unconfirmed'],
          { orderId, bookingId, error: error.message },
          'Get Status confirmation failed',
          'error'
        );
        return { outcome: 'unconfirmed', httpStatus: 500 };
      }

      // The Get Status amount is authoritative; a mismatch blocks the transition.
      if (!amountEquals(confirmed.grossAmount, order.grossAmount)) {
        metrics?.increment?.('amount_mismatch_count');
        log(
          ['webhook', 'amount-mismatch'],
          { orderId, bookingId, grossAmount: confirmed.grossAmount, serverTotal: order.grossAmount },
          'Get Status amount mismatch',
          'error'
        );
        return { outcome: 'amount_mismatch', httpStatus: 200 };
      }

      const confirmedTransactionId = confirmed.transactionId || transactionId;
      const confirmedStatus = confirmed.transactionStatus;
      const confirmedPaymentType = confirmed.paymentType || paymentType;
      const confirmedAmount = Number(confirmed.grossAmount);
      await store.upsertPaymentAttempt({
        orderId,
        bookingId,
        transactionId: confirmedTransactionId,
        transactionStatus: confirmedStatus,
        paymentType: confirmedPaymentType,
        grossAmount: confirmedAmount,
        confirmed: true,
        rawPayload: payload
      });
      await store.updatePaymentOrder(orderId, {
        status: mapOrderStatus(confirmedStatus),
        paymentType: confirmedPaymentType
      });

      // Step 8: map the confirmed status and notify core-module.
      const notifyInput = {
        bookingId,
        orderId,
        transactionId: confirmedTransactionId,
        transactionStatus: confirmedStatus,
        paymentType: confirmedPaymentType,
        grossAmount: confirmedAmount
      };

      if (isFinalSuccess(confirmedStatus, confirmed.fraudStatus)) {
        let result;
        try {
          result = await notifyCore(notifyInput);
        } catch (error) {
          metrics?.increment?.('core_callback_failures');
          log(
            ['webhook', 'core-callback-failed'],
            { orderId, bookingId, error: error.message },
            'Core callback failed',
            'error'
          );
          return { outcome: 'core_callback_failed', httpStatus: 500 };
        }
        if (result?.actionTaken === 'paid_after_expiry') {
          // D11 / ADR-0009: booking already EXPIRED, no ticket, refund flag (core).
          log(
            ['webhook', 'paid-after-expiry'],
            { orderId, bookingId, transactionId: confirmedTransactionId },
            'Payment settled after booking expiry (PAID_AFTER_EXPIRY)',
            'error'
          );
          return { outcome: 'paid_after_expiry', httpStatus: 200 };
        }
        return { outcome: 'settled', httpStatus: 200 };
      }

      if (confirmedStatus === 'expire') {
        try {
          await notifyCore(notifyInput);
        } catch (error) {
          metrics?.increment?.('core_callback_failures');
          log(
            ['webhook', 'core-callback-failed'],
            { orderId, bookingId, error: error.message },
            'Core callback failed',
            'error'
          );
          return { outcome: 'core_callback_failed', httpStatus: 500 };
        }
        return { outcome: 'expired', httpStatus: 200 };
      }

      // pending / deny / cancel / failure / refund: record only. A failed attempt
      // is not a failed booking — the user retries inside Snap while TTL lasts.
      return { outcome: 'recorded', httpStatus: 200 };
    }
  };
}

module.exports = { createWebhookUseCase };
