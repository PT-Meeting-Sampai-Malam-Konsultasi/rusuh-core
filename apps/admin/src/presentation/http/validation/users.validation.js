const Joi = require('joi');
const { paginationSchema } = require('./event.validation');

const listUsersSchema = paginationSchema.keys({
  role: Joi.string().valid('customer', 'officer', 'admin')
});

module.exports = { listUsersSchema };
