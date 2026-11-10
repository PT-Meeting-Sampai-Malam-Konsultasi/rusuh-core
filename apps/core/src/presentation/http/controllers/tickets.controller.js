const { problemError } = require('@/domain/problem');
const { presentTicket } = require('@/domain/presenters');
const { ticketIdParam } = require('../validation/tickets.validation');

/**
 * Creates controllers for the ticket endpoints (paid tickets only, D19).
 *
 * @param {object} useCase - Tickets use case.
 * @returns {object} Ticket endpoint controllers.
 */
function createTicketsController(useCase) {
  return {
    listMyTickets: async (request, response, next) => {
      try {
        const tickets = await useCase.listMyTickets(request.account.sub);
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
        const ticket = await useCase.getTicket(request.params.ticketId, request.account.sub);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(presentTicket(ticket));
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createTicketsController };
