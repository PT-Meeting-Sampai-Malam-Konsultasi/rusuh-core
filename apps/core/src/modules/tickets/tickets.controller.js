const { problemError } = require('@/lib/problem');
const { presentTicket } = require('@/lib/presenters');
const { ticketIdParam } = require('./tickets.validation');

/**
 * Creates controllers for the ticket endpoints (paid tickets only, D19).
 *
 * @param {object} service - Tickets service.
 * @returns {object} Ticket endpoint controllers.
 */
function createTicketsController(service) {
  return {
    listMyTickets: async (request, response, next) => {
      try {
        const tickets = await service.listMyTickets(request.account.sub);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json({ items: tickets.map(presentTicket) });
      } catch (err) {
        next(err);
      }
    },
    getTicket: async (request, response, next) => {
      try {
        const { error } = ticketIdParam.validate(request.params);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const ticket = await service.getTicket(request.params.ticketId, request.account.sub);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(presentTicket(ticket));
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createTicketsController };
