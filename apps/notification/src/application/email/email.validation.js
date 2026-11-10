const Joi = require('joi');

const envelopeSchema = Joi.object({
  type: Joi.string().valid('EMAIL_OTP', 'EMAIL_TICKET', 'EMAIL_EXPIRED').required(),
  to: Joi.string().email().required(),
  request_id: Joi.string().allow('').optional(),
  booking_id: Joi.string().when('type', {
    is: Joi.valid('EMAIL_TICKET', 'EMAIL_EXPIRED'),
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  variables: Joi.object().required(),
  attachments: Joi.array()
    .items(Joi.object({ s3_key: Joi.string().required() }))
    .default([])
}).unknown(false);

const otpVariablesSchema = Joi.object({
  code: Joi.string()
    .pattern(/^\d{6}$/)
    .required(),
  expires_in: Joi.number().integer().positive().default(10)
}).unknown(false);

const ticketVariablesSchema = Joi.object({
  event_name: Joi.string().required(),
  event_date: Joi.string().required(),
  venue: Joi.string().required(),
  doors_open_at: Joi.string().allow('').optional(),
  tickets: Joi.array()
    .items(
      Joi.object({
        category: Joi.string().required(),
        gate: Joi.string().allow('').optional(),
        nik_masked: Joi.string().required(),
        ticket_code: Joi.string().required()
      })
    )
    .min(1)
    .required(),
  download_all_url: Joi.string().uri().allow('').optional()
}).unknown(true);

const expiredVariablesSchema = Joi.object({
  event_name: Joi.string().required(),
  booking_id: Joi.string().required(),
  admin_email: Joi.string().email().allow('').optional()
}).unknown(false);

const variablesSchemas = {
  EMAIL_OTP: otpVariablesSchema,
  EMAIL_TICKET: ticketVariablesSchema,
  EMAIL_EXPIRED: expiredVariablesSchema
};

/**
 * Validates an SQS notification envelope and its per-type variables.
 * Invalid jobs are NOT retryable (they would poison the queue) — the
 * processor returns outcome 'invalid' and the consumer deletes them.
 *
 * @param {object} job - Raw SQS message body (parsed JSON).
 * @returns {object} Validated job (envelope + typed variables).
 * @throws {Error} With `code` = INVALID_JOB on validation failure.
 */
function validateJob(job) {
  const { error: envelopeError, value: envelope } = envelopeSchema.validate(job, { abortEarly: false });
  if (envelopeError) {
    const err = new Error(`Invalid notification envelope: ${envelopeError.details.map((d) => d.message).join(', ')}`);
    err.code = 'INVALID_JOB';
    throw err;
  }
  const schema = variablesSchemas[envelope.type];
  const { error: variablesError, value: variables } = schema.validate(envelope.variables, { abortEarly: false });
  if (variablesError) {
    const err = new Error(
      `Invalid ${envelope.type} variables: ${variablesError.details.map((d) => d.message).join(', ')}`
    );
    err.code = 'INVALID_JOB';
    throw err;
  }
  return { ...envelope, variables };
}

module.exports = { validateJob };
