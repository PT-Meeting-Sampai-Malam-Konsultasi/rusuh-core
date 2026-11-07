const { problemError } = require('@/lib/problem');
const { listEventsQuery, eventIdParam } = require('./events.validation');

/**
 * Creates controllers for the event catalogue endpoints.
 *
 * @param {object} service - Events service.
 * @returns {object} Event endpoint controllers.
 */
function createEventsController(service) {
  return {
    listEvents: async (request, response, next) => {
      try {
        const { error, value } = listEventsQuery.validate(request.query);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        let state;
        if (value.state) state = Array.isArray(value.state) ? value.state : [value.state];
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(await service.listEvents({ state }));
      } catch (err) {
        next(err);
      }
    },
    getEvent: async (request, response, next) => {
      try {
        const { error } = eventIdParam.validate(request.params);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(await service.getEvent(request.params.eventId));
      } catch (err) {
        next(err);
      }
    },
    getCategories: async (request, response, next) => {
      try {
        const { error } = eventIdParam.validate(request.params);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(await service.getCategories(request.params.eventId, request.admission));
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createEventsController };
