const crypto = require('crypto');
const { verifyAccountToken, signAccountToken } = require('@rusuh/auth');
const { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_DAYS } = require('@rusuh/contracts').constants;

/** SHA-256 hex of an opaque refresh token (hash only in the DB, Q44). */
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Token service: issues + verifies account JWTs (Ed25519, Q43) and opaque
 * refresh tokens (Q44). The private key comes from AUTH_JWT_PRIVATE_KEY_JWK;
 * when absent (dev/test) a keypair is generated at startup and a warning is
 * logged — production must provide a key (Secrets Manager).
 *
 * @param {object} config - Runtime configuration.
 * @param {string} [config.jwtPrivateKeyJwk] - Ed25519 private key (JWK JSON).
 * @param {string} [config.jwtKid] - Key id (default akun-YYYYMM-01).
 * @param {string} [config.jwtPublicKeysJwks] - Public keys (JSON map kid -> JWK).
 * @param {object} [config.logger] - Logger (info/warn).
 * @returns {object} Token service.
 */
function createTokenService(config = {}) {
  const logger = config.logger || { info: () => {} };
  const now = new Date();
  const defaultKid = `akun-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const kid = config.jwtKid || defaultKid;

  let privateJwk;
  let generated = false;
  if (config.jwtPrivateKeyJwk) {
    privateJwk = JSON.parse(config.jwtPrivateKeyJwk);
  } else {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    privateJwk = privateKey.export({ format: 'jwk' });
    generated = true;
    logger.info(
      'AUTH_JWT_PRIVATE_KEY_JWK is not set; generated an ephemeral Ed25519 keypair. ' +
        'Tokens will not survive a restart. Set the key in production.'
    );
  }

  const publicKeys = new Map();
  if (config.jwtPublicKeysJwks) {
    const parsed = JSON.parse(config.jwtPublicKeysJwks);
    Object.entries(parsed).forEach(([keyId, jwk]) => publicKeys.set(keyId, jwk));
  }
  if (!publicKeys.has(kid)) {
    const publicKey = crypto.createPublicKey({ key: privateJwk, format: 'jwk' });
    publicKeys.set(kid, publicKey.export({ format: 'jwk' }));
  }

  return {
    getKid: () => kid,
    getPublicKeys: () => publicKeys,
    isGeneratedKey: () => generated,

    /**
     * Signs an access JWT (15 min, claims sub/iat/exp/jti/kid, NO event).
     *
     * @param {string} accountId - Account id (sub).
     * @param {string} familyId - Refresh family id (for audit, not a claim).
     * @returns {{token: string, jti: string, exp: number}} Token + jti + exp (seconds).
     */
    signAccessToken(accountId, familyId) {
      const nowSec = Math.floor(Date.now() / 1000);
      const jti = crypto.randomUUID();
      const exp = nowSec + Math.floor(ACCESS_TOKEN_TTL_MS / 1000);
      const payload = { sub: accountId, iat: nowSec, exp, jti, aud: 'rusuh-api', iss: 'rusuh-auth' };
      const token = signAccountToken(payload, privateJwk, kid);
      return { token, jti, exp, familyId };
    },

    /**
     * Verifies an access JWT via @rusuh/auth.
     *
     * @param {string} token - Account JWT.
     * @param {Function} isDenied - Async (jti) => boolean (denylist check).
     * @returns {Promise<object>} Decoded payload.
     */
    verifyAccessToken(token, isDenied) {
      return verifyAccountToken(token, {
        publicKeys,
        isDenied,
        expectedAud: 'rusuh-api',
        expectedIss: 'rusuh-auth'
      });
    },

    /** Generates an opaque refresh token (rt_ + 192 bits, CSPRNG). */
    createRefreshToken() {
      const token = `rt_${crypto.randomBytes(24).toString('base64url')}`;
      return { token, tokenHash: hashRefreshToken(token) };
    },

    hashRefreshToken,

    /** Refresh family expiry: 7 days from login (rotation does not extend it). */
    refreshFamilyExpiresAt(from = new Date()) {
      return new Date(from.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    }
  };
}

module.exports = { createTokenService, hashRefreshToken };
