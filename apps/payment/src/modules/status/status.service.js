const { MidtransError } = require('@/infrastructure/midtrans/midtrans-client');

/**
 * Status service (internal operations, LLD-03 §6).
 * Get Status is the authoritative confirmation source (ADR-0008); the webhook
 * payload is never trusted alone. Expire is best-effort (412 = already
 * expired/settled, ignored).
 */
function createStatusService({
  midtransClient,
  metrics,
  logger,
  getStatusMaxRetries = 3,
  getStatusRetryBaseMs = 200,
  sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    })
} = {}) {
  if (!midtransClient) throw new Error('createStatusService requires a midtransClient');

  return {
    /**
     * Confirms a transaction via Get Status (ADR-0008). Retries up to
     * getStatusMaxRetries attempts with exponential backoff on 5xx/timeout.
     *
     * @param {string} orderId - Midtrans order_id.
     * @returns {Promise<object>} Confirmed status (Get Status values are authoritative).
     * @throws {Error} code GET_STATUS_NOT_FOUND (404) or GET_STATUS_UNCONFIRMED (retries exhausted).
     */
    async confirmViaGetStatus(orderId) {
      let lastError = null;
      for (let attempt = 1; attempt <= getStatusMaxRetries; attempt += 1) {
        try {
          metrics?.increment?.('get_status_calls');
          // eslint-disable-next-line no-await-in-loop -- sequential retry with backoff must await in order
          const data = await midtransClient.getStatus(orderId);
          return {
            orderId: data.order_id,
            transactionId: data.transaction_id,
            transactionStatus: data.transaction_status,
            fraudStatus: data.fraud_status || null,
            paymentType: data.payment_type || null,
            grossAmount: data.gross_amount,
            statusCode: data.status_code,
            currency: data.currency || 'IDR'
          };
        } catch (error) {
          if (error instanceof MidtransError && error.status === 404) {
            const notFound = new Error(`Get Status 404 for ${orderId}`);
            notFound.code = 'GET_STATUS_NOT_FOUND';
            throw notFound;
          }
          lastError = error;
          metrics?.increment?.('midtrans_5xx_count');
          if (attempt < getStatusMaxRetries) {
            // eslint-disable-next-line no-await-in-loop -- sequential retry with backoff must await in order
            await sleep(getStatusRetryBaseMs * 2 ** (attempt - 1));
          }
        }
      }
      const error = new Error(
        `Get Status failed after ${getStatusMaxRetries} attempts for ${orderId}: ${lastError?.message}`
      );
      error.code = 'GET_STATUS_UNCONFIRMED';
      error.cause = lastError;
      throw error;
    },

    /**
     * Expires a transaction (best-effort, LLD-03 §6.2). Called by the sweeper
     * AFTER the booking is EXPIRED in the DB; a failure never blocks the cancel.
     *
     * @param {string} orderId - Midtrans order_id (latest attempt).
     * @returns {Promise<object>} { ok, orderId, alreadySettledOrExpired? }.
     */
    async expireOrder(orderId) {
      try {
        metrics?.increment?.('expire_calls');
        await midtransClient.expire(orderId);
        return { ok: true, orderId };
      } catch (error) {
        if (error instanceof MidtransError && error.status === 412) {
          return { ok: true, orderId, alreadySettledOrExpired: true };
        }
        metrics?.increment?.('midtrans_5xx_count');
        logger
          ?.addTags?.(['expire', 'failed'])
          ?.addData?.({ orderId, error: error.message })
          ?.error?.('Expire call failed (best-effort, sweeper continues)');
        return { ok: false, orderId, error: error.message };
      }
    }
  };
}

module.exports = { createStatusService };
