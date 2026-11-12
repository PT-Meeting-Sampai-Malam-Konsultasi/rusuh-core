const crypto = require('crypto');
const { createLogger } = require('@rusuh/observability');
const { createStore } = require('@/infrastructure/persistence');
const { createDenylist } = require('@/infrastructure/cache');
const { createMailer } = require('@/infrastructure/messaging');
const { createTokenService } = require('@/infrastructure/tokens/token-service');
const { resolveEncryptionKey } = require('@/domain/nik');

/**
 * Composition root: builds the auth-module dependencies from config.
 * Lives at src/ root (NOT in infrastructure/) because it imports from
 * every layer to wire them together. Adapters fall back to in-memory
 * implementations when their URLs are not set, so the service starts
 * (and is testable) without Postgres, Valkey, or AWS.
 *
 * @param {object} config - Runtime configuration (loadEnvironment).
 * @returns {object} { store, denylist, mailer, tokens, logger, otpSecret, nikEncryptionKey }.
 */
function createDependencies(config = {}) {
  const logger = createLogger({ service: 'auth-module' });
  const store = createStore({ databaseUrl: config.databaseUrl, logger });
  const denylist = createDenylist({ valkeyUrl: config.valkeyUrl });
  const mailer = createMailer({
    sqsQueueUrl: config.sqsQueueUrl,
    awsRegion: config.awsRegion,
    nodeEnv: config.nodeEnv
  });
  const tokens = createTokenService({
    jwtPrivateKeyJwk: config.jwtPrivateKeyJwk,
    jwtKid: config.jwtKid,
    jwtPublicKeysJwks: config.jwtPublicKeysJwks,
    logger
  });
  // OTP HMAC secret (ADR-0006): from env in production; a random ephemeral
  // secret in dev/test (pending OTPs do not survive a restart then).
  const otpSecret = config.otpSecret || crypto.randomBytes(32).toString('hex');
  if (!config.otpSecret) {
    logger.info('OTP_SECRET is not set; using an ephemeral secret. Set it in production.');
  }

  // NIK encryption key (ADR-0031): same key core-module uses, so a profile
  // NIK decrypts like a transaction NIK. Unset = fixed dev key.
  const nikEncryptionKey = resolveEncryptionKey(config.nikEncryptionKey);
  if (!config.nikEncryptionKey) {
    logger.info('NIK_ENCRYPTION_KEY is not set; using a dev key. Set it in production.');
  }

  return { store, denylist, mailer, tokens, logger, otpSecret, nikEncryptionKey };
}

module.exports = { createDependencies };
