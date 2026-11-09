const Joi = require('joi');

// Default CORS origins (production web + local dev). Overridable via
// CORS_ORIGINS (comma-separated). The API is JSON-only and never renders
// HTML, so the origin list is the only CORS surface that matters.
const DEFAULT_CORS_ORIGINS = [
  'https://rusuh-tiket.web.id',
  'https://www.rusuh-tiket.web.id',
  'http://localhost:3000',
  'http://localhost:5173'
];

const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(8082),
  BODY_LIMIT: Joi.string().default('100kb'),
  ENABLE_DUPLICATE_JSON_KEY_VALIDATION: Joi.boolean().truthy('true').falsy('false').default(false),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
  // CORS allowlist (comma-separated origins). Unset/empty = the defaults above.
  CORS_ORIGINS: Joi.string().allow(''),
  // Durable + live stores. When unset, the in-memory adapters are used
  // (tests, local dev). Set them to wire the real Postgres / Valkey.
  DATABASE_URL: Joi.string().uri().allow(''),
  VALKEY_URL: Joi.string().uri().allow(''),
  // Downstream services (internal). Unset = stub mode (local dev).
  DUKCAPIL_URL: Joi.string().uri().default('http://localhost:18082'),
  PAYMENT_URL: Joi.string().uri().allow(''),
  SERVICE_KEY: Joi.string().allow(''),
  // SQS (ADR-0023). Unset = in-memory event bus (local dev).
  // Only empty-slot (core -> queue) and notification (core ->
  // notification-module) remain: admission registration is synchronous
  // via POST /v1/core/admission (ADR-0027), not an SQS queue.
  AWS_REGION: Joi.string().default('ap-southeast-3'),
  SQS_EMPTY_SLOT_QUEUE_URL: Joi.string().uri().allow(''),
  SQS_NOTIFICATION_QUEUE_URL: Joi.string().uri().allow(''),
  // NIK keys (D24). Production: from KMS/Secrets Manager. Dev: derived/fixed.
  NIK_HMAC_KEY: Joi.string().default('rusuh-dev-nik-hmac-key'),
  NIK_ENCRYPTION_KEY: Joi.string().allow(''),
  QR_HMAC_KEY: Joi.string().default('rusuh-dev-qr-hmac-key'),
  // Account JWT verification (Q43): JWKS JSON (kid -> JWK). Unset = dev mode
  // (the server generates a dev keypair at startup and logs a warning).
  AUTH_JWKS: Joi.string().allow(''),
  AUTH_AUDIENCE: Joi.string().default('rusuh-api'),
  AUTH_ISSUER: Joi.string().default('rusuh-auth'),
  // Fees (LLD-02 §8, config).
  PLATFORM_FEE_IDR: Joi.number().integer().min(0).default(30000),
  ADMIN_FEE_IDR: Joi.number().integer().min(0).default(15000),
  PPN_RATE: Joi.number().min(0).max(1).default(0.11),
  TAX2_RATE: Joi.number().min(0).max(1).default(0),
  TAX2_BASE: Joi.number().integer().valid(0, 1, 2).default(0),
  TAX2_LABEL: Joi.string().default('Pajak Lainnya'),
  // Background workers.
  SWEEP_INTERVAL_MS: Joi.number().integer().positive().default(30000),
  DUKCAPIL_TIMEOUT_MS: Joi.number().integer().positive().default(2000),
  ADMISSION_TTL_MS: Joi.number()
    .integer()
    .positive()
    .default(16 * 60 * 1000)
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
    // Comma-separated CORS_ORIGINS, parsed into an array (trimmed, empties
    // dropped). Unset/empty = DEFAULT_CORS_ORIGINS.
    corsOrigins:
      value.CORS_ORIGINS && value.CORS_ORIGINS.trim()
        ? value.CORS_ORIGINS.split(',')
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0)
        : DEFAULT_CORS_ORIGINS,
    databaseUrl: value.DATABASE_URL || null,
    valkeyUrl: value.VALKEY_URL || null,
    dukcapilUrl: value.DUKCAPIL_URL,
    paymentUrl: value.PAYMENT_URL || null,
    serviceKey: value.SERVICE_KEY || null,
    awsRegion: value.AWS_REGION,
    sqsEmptySlotQueueUrl: value.SQS_EMPTY_SLOT_QUEUE_URL || null,
    sqsNotificationQueueUrl: value.SQS_NOTIFICATION_QUEUE_URL || null,
    nikHmacKey: value.NIK_HMAC_KEY,
    nikEncryptionKey: value.NIK_ENCRYPTION_KEY || null,
    qrHmacKey: value.QR_HMAC_KEY,
    authJwks: value.AUTH_JWKS || null,
    authAudience: value.AUTH_AUDIENCE,
    authIssuer: value.AUTH_ISSUER,
    fees: {
      platformFee: value.PLATFORM_FEE_IDR,
      adminFee: value.ADMIN_FEE_IDR,
      ppnRate: value.PPN_RATE,
      tax2Rate: value.TAX2_RATE,
      tax2Base: value.TAX2_BASE,
      tax2Label: value.TAX2_LABEL
    },
    sweepIntervalMs: value.SWEEP_INTERVAL_MS,
    dukcapilTimeoutMs: value.DUKCAPIL_TIMEOUT_MS,
    admissionTtlMs: value.ADMISSION_TTL_MS
  };
}

module.exports = { loadEnvironment, DEFAULT_CORS_ORIGINS };
