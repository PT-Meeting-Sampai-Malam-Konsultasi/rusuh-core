const { ApiError } = require('@/domain/errors');
const { createEventSchema, updateEventSchema, capSchema } = require('../validation/event.validation');

/**
 * Validates a Joi schema against the request body (or query).
 *
 * @param {object} schema - Joi schema.
 * @param {object} value - Value to validate.
 * @returns {object} Validated value.
 * @throws {ApiError} VALIDATION_FAILED on any violation.
 */
function validate(schema, value) {
  const { error, value: validated } = schema.validate(value, { abortEarly: false, convert: true, stripUnknown: true });
  if (error) throw new ApiError('VALIDATION_FAILED', error.details.map((detail) => detail.message).join(', '));
  return validated;
}

/**
 * Creates controllers for the admin event endpoints (LLD-05 §5.1–§5.2).
 *
 * @param {object} eventUseCase - Event use case.
 * @returns {object} Event endpoint controllers.
 */
function createEventController(eventUseCase) {
  return {
    listEvents: async (_request, response) => {
      response.locals.skipResponseEnvelope = true;
      const events = await eventUseCase.listEvents();
      response.status(200).json({ data: events, meta: { total: events.length, page: 1, limit: events.length } });
    },

    getEvent: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const event = await eventUseCase.getEvent(request.params.eventId);
      response.status(200).json(event);
    },

    createEvent: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const body = validate(createEventSchema, request.body);
      const event = await eventUseCase.createEvent(body, request.admin);
      response.status(201).json(event);
    },

    updateEvent: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const body = validate(updateEventSchema, request.body);
      const event = await eventUseCase.updateEvent(request.params.eventId, body, request.admin);
      response.status(200).json(event);
    },

    getCap: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const cap = await eventUseCase.getCap(request.params.eventId);
      response.status(200).json(cap);
    },

    updateCap: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const body = validate(capSchema, request.body);
      const cap = await eventUseCase.updateCap(
        request.params.eventId,
        { cap: body.cap, capTier: body.cap_tier },
        request.admin
      );
      response.status(200).json(cap);
    },

    getStats: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const stats = await eventUseCase.getStats(request.params.eventId);
      response.status(200).json(stats);
    }
  };
}

module.exports = { createEventController };
