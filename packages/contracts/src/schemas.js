const Joi = require('joi');

/** Email address (account identifier). */
const email = Joi.string().email().required();

module.exports = { email };
