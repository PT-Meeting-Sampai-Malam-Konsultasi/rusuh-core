const express = require('express');

/**
 * Creates the tickets router.
 *
 * @param {object} controller - Tickets controllers.
 * @param {object} auth - Auth middleware ({ requireAccount }).
 * @returns {import('express').Router} Express tickets router.
 */
function createTicketsRouter(controller, auth) {
  const router = express.Router();
  router.get('/v1/tickets', auth.requireAccount, controller.listMyTickets);
  router.get('/v1/tickets/:ticketId', auth.requireAccount, controller.getTicket);
  return router;
}

module.exports = { createTicketsRouter };
