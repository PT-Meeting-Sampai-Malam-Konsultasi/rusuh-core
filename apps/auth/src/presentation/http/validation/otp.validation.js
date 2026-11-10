const Joi = require('joi');
const { schemas } = require('@rusuh/contracts');

/** OTP request body (openapi.yaml requestOtp). */
const requestOtpSchema = Joi.object({
  email: schemas.email,
  fullName: Joi.string().trim().min(1).max(200).optional(),
  consentVersion: Joi.string().optional(),
  locale: Joi.string().valid('id', 'en').default('id'),
  deviceId: Joi.string().optional()
});

/** OTP verify body (openapi.yaml verifyOtp + LLD-01 email alias). */
const verifyOtpSchema = Joi.object({
  challengeId: Joi.string().optional(),
  email: schemas.email.optional(),
  code: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .required(),
  deviceId: Joi.string().optional()
}).or('challengeId', 'email');

module.exports = { requestOtpSchema, verifyOtpSchema };
