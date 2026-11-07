const { ticketIdParam, eventIdParam, scanBody, attendeesQuery, validate } = require('./officer.validation');

/**
 * Creates controllers for the officer endpoints.
 *
 * @param {object} officerService - Officer service implementation.
 * @returns {object} Officer endpoint controllers.
 */
function createOfficerController(officerService) {
  return {
    lookup: async (request, response, next) => {
      try {
        const { ticketId } = validate(ticketIdParam, request.params);
        const ticket = await officerService.lookupTicket(ticketId);
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
        const ticket = await officerService.scanTicket(ticketId, {
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
        const result = await officerService.listAttendees(eventId, paging);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(result);
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = { createOfficerController };
