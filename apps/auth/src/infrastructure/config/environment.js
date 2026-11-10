const Joi = require('joi');

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
  // Comma-separated CORS origins. When unset/empty, the production
  // domains + local dev origins are used (see DEFAULT_CORS_ORIGINS).
  CORS_ORIGINS: Joi.string().allow('').optional()
}).unknown(true);

/** Default CORS origins (production domains + local dev). */
const DEFAULT_CORS_ORIGINS = [
  'https://rusuh-tiket.web.id',
  'https://www.rusuh-tiket.web.id',
  'http://localhost:3000',
  'http://localhost:5173'
];

/**
 * Parses a comma-separated CORS origins string into an array.
 *
 * @param {string} [value] - Comma-separated origins.
 * @returns {string[]} Origins (the default list when unset/empty).
 */
function parseCorsOrigins(value) {
  if (!value) return [...DEFAULT_CORS_ORIGINS];
  const parsed = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_CORS_ORIGINS];
}

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
    corsOrigins: parseCorsOrigins(value.CORS_ORIGINS)
  };
}

module.exports = { loadEnvironment };
