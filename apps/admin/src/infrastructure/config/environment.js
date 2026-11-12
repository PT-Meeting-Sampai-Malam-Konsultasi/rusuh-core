const Joi = require('joi');
const { parseCorsOrigins } = require('@rusuh/http');

const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(8086),
  BODY_LIMIT: Joi.string().default('100kb'),
  ENABLE_DUPLICATE_JSON_KEY_VALIDATION: Joi.boolean().truthy('true').falsy('false').default(false),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
  DATABASE_URL: Joi.string().uri().allow(null, ''),
  AUTH_PUBLIC_KEY_JWK: Joi.string().allow(null, ''),
  AUTH_JWKS_URL: Joi.string().uri().allow(null, ''),
  AUTH_AUDIENCE: Joi.string().allow(null, ''),
  AUTH_ISSUER: Joi.string().allow(null, ''),
  AUTH_URL: Joi.string().uri().allow(null, ''),
  SERVICE_KEY: Joi.string().allow(null, ''),
  VALKEY_URL: Joi.string().uri().allow(null, ''),
  ASSETS_BUCKET: Joi.string().allow(null, ''),
  ASSET_BASE_URL: Joi.string().uri().allow(null, ''),
  AWS_REGION: Joi.string().default('ap-southeast-3'),
  QUEUE_ADMIN_URL: Joi.string().uri().allow(null, ''),
  QUEUE_ADMIN_TOKEN: Joi.string().allow(null, ''),
  CORS_ORIGINS: Joi.string().allow(null, '').default('')
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
    databaseUrl: value.DATABASE_URL || null,
    authPublicKeyJwk: value.AUTH_PUBLIC_KEY_JWK || null,
    authJwksUrl: value.AUTH_JWKS_URL || null,
    authAudience: value.AUTH_AUDIENCE || null,
    authIssuer: value.AUTH_ISSUER || null,
    authUrl: value.AUTH_URL || null,
    serviceKey: value.SERVICE_KEY || null,
    valkeyUrl: value.VALKEY_URL || null,
    assetsBucket: value.ASSETS_BUCKET || null,
    assetBaseUrl: value.ASSET_BASE_URL || null,
    awsRegion: value.AWS_REGION,
    queueAdminUrl: value.QUEUE_ADMIN_URL || null,
    queueAdminToken: value.QUEUE_ADMIN_TOKEN || null,
    corsOrigins: parseCorsOrigins(value.CORS_ORIGINS)
  };
}

module.exports = { loadEnvironment };
