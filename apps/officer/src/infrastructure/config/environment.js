const Joi = require('joi');

const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(8085),
  BODY_LIMIT: Joi.string().default('100kb'),
  ENABLE_DUPLICATE_JSON_KEY_VALIDATION: Joi.boolean().truthy('true').falsy('false').default(false),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
  DATABASE_URL: Joi.string().optional(),
  NIK_ENCRYPTION_KEY: Joi.string().optional(),
  AUTH_PUBLIC_KEYS_JSON: Joi.string().optional(),
  AUTH_AUDIENCE: Joi.string().optional(),
  AUTH_ISSUER: Joi.string().optional(),
  CORS_ORIGINS: Joi.string().optional()
}).unknown(true);

// Default CORS origins when CORS_ORIGINS is unset or empty: the production
// web (rusuh-tiket.web.id) plus the local dev frontends.
const DEFAULT_CORS_ORIGINS = [
  'https://rusuh-tiket.web.id',
  'https://www.rusuh-tiket.web.id',
  'http://localhost:3000',
  'http://localhost:5173'
];

/**
 * Parses a comma-separated CORS_ORIGINS string into an array of origins.
 * Empty entries are dropped; when nothing remains, the default origins
 * are returned.
 *
 * @param {string} [origins] - Comma-separated origins.
 * @returns {string[]} Origin list.
 */
function parseCorsOrigins(origins) {
  const parsed = String(origins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_CORS_ORIGINS];
}

/**
 * Parses AUTH_PUBLIC_KEYS_JSON ({ kid: JWK }) into a Map.
 *
 * @param {string} [json] - JSON string.
 * @returns {Map<string, object>|null} kid -> JWK, or null when unset.
 * @throws {Error} When the JSON is malformed.
 */
function parsePublicKeys(json) {
  if (!json) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (_error) {
    throw new Error('Invalid environment configuration: AUTH_PUBLIC_KEYS_JSON is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid environment configuration: AUTH_PUBLIC_KEYS_JSON must be an object { kid: JWK }');
  }
  return new Map(Object.entries(parsed));
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
    databaseUrl: value.DATABASE_URL || null,
    nikEncryptionKey: value.NIK_ENCRYPTION_KEY || null,
    authPublicKeys: parsePublicKeys(value.AUTH_PUBLIC_KEYS_JSON),
    authAudience: value.AUTH_AUDIENCE || null,
    authIssuer: value.AUTH_ISSUER || null,
    corsOrigins: parseCorsOrigins(value.CORS_ORIGINS)
  };
}

module.exports = { loadEnvironment, parseCorsOrigins, DEFAULT_CORS_ORIGINS };
