const Joi = require('joi');

const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(8084),
  BODY_LIMIT: Joi.string().default('100kb'),
  ENABLE_DUPLICATE_JSON_KEY_VALIDATION: Joi.boolean().truthy('true').falsy('false').default(false),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
  AWS_REGION: Joi.string().default('ap-southeast-3'),
  SQS_OTP_QUEUE_URL: Joi.string().uri().allow('').default(''),
  SQS_EMAIL_QUEUE_URL: Joi.string().uri().allow('').default(''),
  SES_FROM_EMAIL: Joi.string().email().default('noreply@rusuh-tiket.web.id'),
  SES_MAX_SENDS_PER_SECOND: Joi.number().integer().positive().default(10),
  CONSUMER_CONCURRENCY: Joi.number().integer().positive().default(5),
  CONSUMER_MAX_BATCH: Joi.number().integer().min(1).max(10).default(10),
  DATABASE_URL: Joi.string().uri().allow('').default(''),
  S3_TICKET_BUCKET: Joi.string().allow('').default(''),
  ADMIN_EMAIL: Joi.string().email().default('admin@rusuh-tiket.web.id'),
  CLAIM_STALE_MINUTES: Joi.number().integer().positive().default(5),
  WORKER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true)
}).unknown(true);

/**
 * Validates process environment and returns the service runtime configuration.
 *
 * Queue URLs and DATABASE_URL are optional: when absent the worker is disabled
 * (HTTP health endpoints still serve) or the email_log falls back to memory.
 * Production must set all of them.
 *
 * @param {NodeJS.ProcessEnv} environment - Source environment variables.
 * @returns {object} Validated runtime configuration.
 * @throws {Error} When an environment value is invalid or unexpected.
 */
function loadEnvironment(environment = process.env) {
  const { error, value } = environmentSchema.validate(environment, {
    abortEarly: false,
    convert: true,
    stripUnknown: true
  });

  if (error) {
    throw new Error(`Invalid environment configuration: ${error.details.map((detail) => detail.message).join(', ')}`);
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    bodyLimit: value.BODY_LIMIT,
    enableDuplicateJsonKeyValidation: value.ENABLE_DUPLICATE_JSON_KEY_VALIDATION,
    gracefulShutdownTimeoutMs: value.GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    aws: { region: value.AWS_REGION },
    sqs: { otpQueueUrl: value.SQS_OTP_QUEUE_URL, emailQueueUrl: value.SQS_EMAIL_QUEUE_URL },
    ses: { fromEmail: value.SES_FROM_EMAIL, maxSendsPerSecond: value.SES_MAX_SENDS_PER_SECOND },
    consumer: { concurrency: value.CONSUMER_CONCURRENCY, maxBatch: value.CONSUMER_MAX_BATCH },
    databaseUrl: value.DATABASE_URL,
    s3: { ticketBucket: value.S3_TICKET_BUCKET },
    adminEmail: value.ADMIN_EMAIL,
    claimStaleMinutes: value.CLAIM_STALE_MINUTES,
    workerEnabled: value.WORKER_ENABLED
  };
}

module.exports = { loadEnvironment };
