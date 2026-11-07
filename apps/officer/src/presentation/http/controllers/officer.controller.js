const { ticketIdParam, eventIdParam, scanBody, attendeesQuery, validate } = require('../validation/officer.validation');

/**
 * Creates controllers for the officer endpoints.
 *
 * @param {object} officerUseCase - Officer use case implementation.
 * @returns {object} Officer endpoint controllers.
 */
function createOfficerController(officerUseCase) {
  return {
    lookup: async (request, response, next) => {
      try {
        const { ticketId } = validate(ticketIdParam, request.params);
        const ticket = await officerUseCase.lookupTicket(ticketId);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(ticket);
      } catch (error) {
        next(error);
      }
    },

    scan: async (request, response, next) => {
      try {
        const { ticketId } = validate(ticketIdParam, request.params);
        const body = validate(scanBody, request.body || {});
        const ticket = await officerUseCase.scanTicket(ticketId, {
          officerId: request.account.id,
          gate: body.gate
        });
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(ticket);
      } catch (error) {
        next(error);
      }
    },

    listAttendees: async (request, response, next) => {
      try {
        const { eventId } = validate(eventIdParam, request.params);
        const paging = validate(attendeesQuery, request.query || {});
        const result = await officerUseCase.listAttendees(eventId, paging);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(result);
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = { createOfficerController };
