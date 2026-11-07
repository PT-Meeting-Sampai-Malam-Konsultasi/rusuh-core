const Joi = require('joi');

const ticketIdParam = Joi.object({
  ticketId: Joi.string().required()
});

module.exports = { ticketIdParam };
