const { ApiError } = require('@/errors');
const { createEventSchema, updateEventSchema, capSchema } = require('./event.validation');

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
 * @param {object} eventService - Event service.
 * @returns {object} Event endpoint controllers.
 */
function createEventController(eventService) {
  return {
    listEvents: async (_request, response) => {
      response.locals.skipResponseEnvelope = true;
      const events = await eventService.listEvents();
      response.status(200).json({ data: events, meta: { total: events.length, page: 1, limit: events.length } });
    },

    getEvent: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const event = await eventService.getEvent(request.params.eventId);
      response.status(200).json(event);
    },

    createEvent: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const body = validate(createEventSchema, request.body);
      const event = await eventService.createEvent(body, request.admin);
      response.status(201).json(event);
    },

    updateEvent: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const body = validate(updateEventSchema, request.body);
      const event = await eventService.updateEvent(request.params.eventId, body, request.admin);
      response.status(200).json(event);
    },

    getCap: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const cap = await eventService.getCap(request.params.eventId);
      response.status(200).json(cap);
    },

    updateCap: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const body = validate(capSchema, request.body);
      const cap = await eventService.updateCap(
        request.params.eventId,
        { cap: body.cap, capTier: body.cap_tier },
        request.admin
      );
      response.status(200).json(cap);
    },

    getStats: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const stats = await eventService.getStats(request.params.eventId);
      response.status(200).json(stats);
    }
  };
}

module.exports = { createEventController };
