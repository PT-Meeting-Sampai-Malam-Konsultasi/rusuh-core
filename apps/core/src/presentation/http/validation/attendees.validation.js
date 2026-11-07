const Joi = require('joi');

const validateAttendeeBody = Joi.object({
  fieldIndex: Joi.number().integer().min(0).max(2).required(),
  fullName: Joi.string().trim().min(1).max(100).required(),
  nik: Joi.string()
    .pattern(/^[0-9]{16}$/)
    .required()
});

const eventIdParam = Joi.object({
  eventId: Joi.string().required()
});

module.exports = { validateAttendeeBody, eventIdParam };
