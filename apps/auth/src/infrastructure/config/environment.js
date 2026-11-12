const Joi = require('joi');
const { parseCorsOrigins } = require('@rusuh/http');

const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(8081),
  BODY_LIMIT: Joi.string().default('100kb'),
  ENABLE_DUPLICATE_JSON_KEY_VALIDATION: Joi.boolean().truthy('true').falsy('false').default(false),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
  // Auth-module dependencies (all optional: when unset the service falls
  // back to in-memory adapters, so it starts without Postgres/Valkey/AWS).
  DATABASE_URL: Joi.string().uri().optional(),
  VALKEY_URL: Joi.string().uri().optional(),
  SQS_QUEUE_URL: Joi.string().uri().optional(),
  AWS_REGION: Joi.string().default('ap-southeast-3'),
  AUTH_JWT_PRIVATE_KEY_JWK: Joi.string().optional(),
  AUTH_JWT_KID: Joi.string().optional(),
  AUTH_JWT_PUBLIC_KEYS_JWKS: Joi.string().optional(),
  OTP_SECRET: Joi.string().optional(),
  // OTP code lifetime in ms, clamped to the LLD-01 §7 decided range of
  // 5–10 minutes. Default 10 min (current behaviour); the login design
  // shows 5 min — set OTP_TTL_MS=300000 to match it.
  OTP_TTL_MS: Joi.number().integer().min(300000).max(600000).default(600000),
  // Shared service credential for internal endpoints (core-module -> auth;
  // unset = the internal endpoints reject everything, fail-closed).
  SERVICE_KEY: Joi.string().allow('').optional(),
  // Comma-separated CORS origins. When unset/empty, the production
  // domains + local dev origins are used (see @rusuh/http).
  CORS_ORIGINS: Joi.string().allow('').optional()
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
    databaseUrl: value.DATABASE_URL,
    valkeyUrl: value.VALKEY_URL,
    sqsQueueUrl: value.SQS_QUEUE_URL,
    awsRegion: value.AWS_REGION,
    jwtPrivateKeyJwk: value.AUTH_JWT_PRIVATE_KEY_JWK,
    jwtKid: value.AUTH_JWT_KID,
    jwtPublicKeysJwks: value.AUTH_JWT_PUBLIC_KEYS_JWKS,
    otpSecret: value.OTP_SECRET,
    otpTtlMs: value.OTP_TTL_MS,
    serviceKey: value.SERVICE_KEY || null,
    corsOrigins: parseCorsOrigins(value.CORS_ORIGINS)
  };
}

module.exports = { loadEnvironment };
