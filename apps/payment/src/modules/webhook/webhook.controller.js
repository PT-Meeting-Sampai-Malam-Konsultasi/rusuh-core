/**
 * Creates the Midtrans webhook controller (the ONLY public endpoint).
 * Always answers 200 once the event is stored — including duplicates and
 * invalid signatures (Q45) — so Midtrans does not retry a request that can
 * never succeed. The one exception is an unconfirmed Get Status (500,
 * Midtrans retries once, LLD-03 §5.1 step 7).
 */
function createWebhookController(webhookService, { bodyLimitBytes = 65536, logger } = {}) {
  if (!webhookService) throw new Error('createWebhookController requires a webhookService');

  return {
    handleNotification: async (request, response, next) => {
      try {
        const contentLength = Number(request.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > bodyLimitBytes) {
          logger
            ?.addTags?.(['webhook', 'body-too-large'])
            ?.addData?.({ contentLength, bodyLimitBytes })
            ?.error?.('Webhook body exceeds limit');
          response.locals.skipResponseEnvelope = true;
          response.status(200).end();
          return;
        }

        const result = await webhookService.processNotification(request.body);
        response.locals.skipResponseEnvelope = true;
        response.status(result.httpStatus).end();
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = { createWebhookController };
