const Joi = require('joi');
const { schemas } = require('@rusuh/contracts');

const sixDigits = Joi.string()
  .pattern(/^[0-9]{6}$/)
  .required();

/** Start email-change body (openapi.yaml startEmailChange). */
const startEmailChangeSchema = Joi.object({
  newEmail: schemas.email
});

/** Verify email-change body (openapi.yaml verifyEmailChange). */
const verifyEmailChangeSchema = Joi.object({
  challengeId: Joi.string().required(),
  oldEmailCode: sixDigits,
  newEmailCode: sixDigits
});

module.exports = { startEmailChangeSchema, verifyEmailChangeSchema };
