const Joi = require('joi');
const { paginationSchema } = require('@/modules/events/event.validation');

const listUsersSchema = paginationSchema.keys({
  role: Joi.string().valid('customer', 'officer', 'admin')
});

module.exports = { listUsersSchema };
