const express = require('express');

/**
 * Creates the internal router for core-module (ADR-0028: /v1/internal/* is
 * service-to-service and blocked from the internet by the ALB rule). Every
 * route sits behind the service-key middleware.
 *
 * @param {object} controller - Internal controller.
 * @param {Function} requireServiceKey - Service credential middleware.
 * @returns {import('express').Router} Express router.
 */
function createInternalRouter(controller, requireServiceKey) {
  const router = express.Router();
  router.use('/v1/internal', requireServiceKey);
  router.post('/v1/internal/payments/snap', controller.createSnap);
  router.get('/v1/internal/payments/orders/:orderId/status', controller.getStatus);
  router.post('/v1/internal/payments/orders/:orderId/expire', controller.expire);
  return router;
}

module.exports = { createInternalRouter };
