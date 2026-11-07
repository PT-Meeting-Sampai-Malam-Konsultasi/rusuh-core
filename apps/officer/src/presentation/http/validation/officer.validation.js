const Boom = require('@hapi/boom');
const Joi = require('joi');

const ticketIdParam = Joi.object({
  ticketId: Joi.string().min(1).max(64).required()
});

const eventIdParam = Joi.object({
  eventId: Joi.string().min(1).max(64).required()
});

const scanBody = Joi.object({
  gate: Joi.string().max(64).optional()
});

const attendeesQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50)
});

/**
 * Validates a value against a Joi schema; throws a 400 on failure.
 *
 * @param {object} schema - Joi schema.
 * @param {unknown} value - Value to validate.
 * @returns {object} Validated value (with defaults applied).
 * @throws {Error} Boom 400 (data.code = VALIDATION_FAILED).
 */
function validate(schema, value) {
  const { error, value: validated } = schema.validate(value, { abortEarly: false, convert: true });
  if (error) {
    const boomError = Boom.badRequest(`Validation failed: ${error.details.map((detail) => detail.message).join(', ')}`);
    boomError.data = { code: 'VALIDATION_FAILED' };
    throw boomError;
  }
  return validated;
}

module.exports = { ticketIdParam, eventIdParam, scanBody, attendeesQuery, validate };
