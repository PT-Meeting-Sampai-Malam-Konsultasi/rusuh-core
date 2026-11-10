const Joi = require('joi');

const envelopeSchema = Joi.object({
  type: Joi.string().valid('EMAIL_OTP', 'EMAIL_TICKET', 'EMAIL_EXPIRED', 'EMAIL_REFUND_FLAGGED').required(),
  to: Joi.string().email().required(),
  locale: Joi.string().valid('id', 'en').default('id'),
  request_id: Joi.string().allow('').optional(),
  booking_id: Joi.string().when('type', {
    is: Joi.valid('EMAIL_TICKET', 'EMAIL_EXPIRED', 'EMAIL_REFUND_FLAGGED'),
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
  code_spaced: Joi.string().required(),
  expires_at: Joi.string().required(),
  email: Joi.string().email().required()
}).unknown(false);

const ticketVariablesSchema = Joi.object({
  event_name: Joi.string().required(),
  event_date: Joi.string().required(),
  event_time: Joi.string().required(),
  venue: Joi.string().required(),
  order_code: Joi.string().required(),
  total: Joi.string().required(),
  payment_method: Joi.string().required(),
  paid_at: Joi.string().required(),
  count: Joi.number().integer().min(1).required(),
  event_subtitle: Joi.string().allow('').optional(),
  doors_open_at: Joi.string().allow('').optional(),
  ticket_url: Joi.string().uri().allow('').optional(),
  download_all_url: Joi.string().uri().allow('').optional(),
  email: Joi.string().email().allow('').optional(),
  tickets: Joi.array()
    .items(
      Joi.object({
        index: Joi.number().integer().min(1).required(),
        category: Joi.string().required(),
        holder_name: Joi.string().required(),
        nik_masked: Joi.string().required(),
        ticket_code: Joi.string().required(),
        gate: Joi.string().allow('').optional()
      }).unknown(false)
    )
    .min(1)
    .required()
}).unknown(false);

const expiredVariablesSchema = Joi.object({
  event_name: Joi.string().required(),
  order_code: Joi.string().required(),
  total: Joi.string().required(),
  deadline: Joi.string().required(),
  email: Joi.string().email().required(),
  event_url: Joi.string().uri().allow('').optional()
}).unknown(false);

const refundVariablesSchema = Joi.object({
  event_name: Joi.string().required(),
  order_code: Joi.string().required(),
  total: Joi.string().required(),
  payment_method: Joi.string().required(),
  paid_at: Joi.string().required(),
  deadline: Joi.string().required(),
  refund_window: Joi.string().required(),
  transaction_id: Joi.string().required(),
  email: Joi.string().email().required()
}).unknown(false);

const variablesSchemas = {
  EMAIL_OTP: otpVariablesSchema,
  EMAIL_TICKET: ticketVariablesSchema,
  EMAIL_EXPIRED: expiredVariablesSchema,
  EMAIL_REFUND_FLAGGED: refundVariablesSchema
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
