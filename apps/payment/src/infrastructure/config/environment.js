const Joi = require('joi');
const { parseCorsOrigins } = require('@rusuh/http');

const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(8083),
  BODY_LIMIT: Joi.string().default('100kb'),
  ENABLE_DUPLICATE_JSON_KEY_VALIDATION: Joi.boolean().truthy('true').falsy('false').default(false),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  MIDTRANS_SERVER_KEY: Joi.string().allow('').default(''),
  MIDTRANS_SNAP_BASE_URL: Joi.string().uri().default('https://app.sandbox.midtrans.com/snap'),
  MIDTRANS_API_BASE_URL: Joi.string().uri().default('https://api.sandbox.midtrans.com'),
  MIDTRANS_CLIENT_KEY: Joi.string().allow('').default(''),
  DATABASE_URL: Joi.string().allow('').default(''),
  PAYMENT_STORE: Joi.string().valid('memory', 'postgres').optional(),
  CORE_INTERNAL_URL: Joi.string().uri().default('http://localhost:8082'),
  CORE_SERVICE_CREDENTIAL: Joi.string().allow('').default(''),
  WEBHOOK_BODY_LIMIT_BYTES: Joi.number().integer().positive().default(65536),
  GET_STATUS_MAX_RETRIES: Joi.number().integer().min(1).default(3),
  GET_STATUS_RETRY_BASE_MS: Joi.number().integer().min(0).default(200),
  CORE_NOTIFY_MAX_RETRIES: Joi.number().integer().min(1).default(3),
  CORE_NOTIFY_RETRY_BASE_MS: Joi.number().integer().min(0).default(200),
  CORE_NOTIFY_TIMEOUT_MS: Joi.number().integer().positive().default(5000),
  PAYMENT_FINISH_URL: Joi.string().uri().allow('').default(''),
  PAYMENT_UNFINISH_URL: Joi.string().uri().allow('').default(''),
  PAYMENT_ERROR_URL: Joi.string().uri().allow('').default('')
}).unknown(true);

/**
 * Validates process environment and returns the service runtime configuration.
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
    corsOrigins: parseCorsOrigins(value.CORS_ORIGINS),
    midtrans: {
      serverKey: value.MIDTRANS_SERVER_KEY,
      snapBaseUrl: value.MIDTRANS_SNAP_BASE_URL,
      apiBaseUrl: value.MIDTRANS_API_BASE_URL,
      clientKey: value.MIDTRANS_CLIENT_KEY
    },
    databaseUrl: value.DATABASE_URL,
    paymentStore: value.PAYMENT_STORE || (value.DATABASE_URL ? 'postgres' : 'memory'),
    core: {
      internalUrl: value.CORE_INTERNAL_URL,
      serviceCredential: value.CORE_SERVICE_CREDENTIAL,
      notifyMaxRetries: value.CORE_NOTIFY_MAX_RETRIES,
      notifyRetryBaseMs: value.CORE_NOTIFY_RETRY_BASE_MS,
      notifyTimeoutMs: value.CORE_NOTIFY_TIMEOUT_MS
    },
    webhookBodyLimitBytes: value.WEBHOOK_BODY_LIMIT_BYTES,
    getStatusMaxRetries: value.GET_STATUS_MAX_RETRIES,
    getStatusRetryBaseMs: value.GET_STATUS_RETRY_BASE_MS,
    callbacks: {
      finish: value.PAYMENT_FINISH_URL || undefined,
      unfinish: value.PAYMENT_UNFINISH_URL || undefined,
      error: value.PAYMENT_ERROR_URL || undefined
    }
  };
}

module.exports = { loadEnvironment };
