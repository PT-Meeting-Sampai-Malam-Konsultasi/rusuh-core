const express = require('express');

/**
 * Creates the Midtrans webhook router (POST /v1/webhooks/midtrans).
 *
 * @param {object} controller - Webhook controllers.
 * @returns {import('express').Router} Express webhook router.
 */
function createWebhookRouter(controller) {
  const router = express.Router();
  router.post('/v1/webhooks/midtrans', controller.handleNotification);
  return router;
}

/**
 * Webhook-scoped error handler (LLD-03 §5.1 step 3, Q45). A notification that
 * cannot be parsed (malformed JSON, body too large) is answered 200 with no
 * state change, so Midtrans does not retry it. Errors from other routes are
 * passed on to the global error handler.
 */
// eslint-disable-next-line no-unused-vars -- Express requires the 4th error-middleware argument.
function webhookErrorHandler(error, request, response, next) {
  const isWebhook =
    request.originalUrl === '/v1/webhooks/midtrans' || request.originalUrl.startsWith('/v1/webhooks/midtrans?');
  const isMalformedJson = error instanceof SyntaxError && Object.hasOwn(error, 'body');
  const isBodyTooLarge = error.type === 'entity.too.large';
  if (isWebhook && (isMalformedJson || isBodyTooLarge)) {
    response.locals.skipResponseEnvelope = true;
    response.status(200).end();
    return;
  }
  next(error);
}

module.exports = { createWebhookRouter, webhookErrorHandler };
