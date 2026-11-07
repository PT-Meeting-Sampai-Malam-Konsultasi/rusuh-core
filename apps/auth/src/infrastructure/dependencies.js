const crypto = require('crypto');
const { createLogger } = require('@rusuh/observability');
const { createStore } = require('./store');
const { createDenylist } = require('./valkey');
const { createMailer } = require('./mailer');
const { createTokenService } = require('./tokens/token-service');

/**
 * Builds the auth-module dependencies from config. Adapters fall back to
 * in-memory implementations when their URLs are not set, so the service
 * starts (and is testable) without Postgres, Valkey, or AWS.
 *
 * @param {object} config - Runtime configuration (loadEnvironment).
 * @returns {object} { store, denylist, mailer, tokens, logger, otpSecret }.
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

  return { store, denylist, mailer, tokens, logger, otpSecret };
}

module.exports = { createDependencies };
