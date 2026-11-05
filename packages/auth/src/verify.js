const crypto = require('crypto');

/**
 * Verifies an account JWT (Ed25519, Q43 shared library).
 * Claims: sub (account id), iat, exp, jti, kid. No event claim.
 * Signature is verified locally against the shared public key set (JWKS);
 * the jti denylist (Valkey) is consulted through the provided callback.
 *
 * @param {string} token - Account JWT (header.payload.signature, base64url).
 * @param {object} options - Verification inputs.
 * @param {Map<string, object>} options.publicKeys - kid -> JWK (Ed25519 public key).
 * @param {Function} [options.isDenied] - Async (jti) => boolean.
 * @param {string} [options.expectedAud] - Expected audience.
 * @param {string} [options.expectedIss] - Expected issuer.
 * @param {number} [options.clockToleranceSec] - Leeway for exp/iat (default 60).
 * @param {number} [options.nowSec] - Override for current time (tests).
 * @returns {Promise<object>} Decoded payload.
 * @throws {Error} With `code` = UNAUTHORIZED on any verification failure.
 */
async function verifyAccountToken(
  token,
  {
    publicKeys,
    isDenied = async () => false,
    expectedAud,
    expectedIss,
    clockToleranceSec = 60,
    nowSec = Math.floor(Date.now() / 1000)
  } = {}
) {
  const unauthorized = (message) => {
    const error = new Error(message);
    error.code = 'UNAUTHORIZED';
    error.status = 401;
    return error;
  };

  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw unauthorized('Malformed account token');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (_error) {
    throw unauthorized('Malformed account token');
  }

  if (header.alg !== 'EdDSA' || header.typ !== 'at+jwt') throw unauthorized('Unknown kid or algorithm');
  if (!header.kid || !publicKeys || !publicKeys.has(header.kid)) throw unauthorized('Unknown kid or algorithm');
  if (expectedAud && payload.aud !== expectedAud) throw unauthorized('Wrong audience');
  if (expectedIss && payload.iss !== expectedIss) throw unauthorized('Wrong issuer');
  if (typeof payload.exp !== 'number' || payload.exp + clockToleranceSec < nowSec) throw unauthorized('Token expired');
  if (typeof payload.iat === 'number' && payload.iat - clockToleranceSec > nowSec)
    throw unauthorized('Token not yet valid');
  if (!payload.sub || !payload.jti) throw unauthorized('Missing sub or jti');

  const jwk = publicKeys.get(header.kid);
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (_error) {
    throw unauthorized('Unknown kid or algorithm');
  }
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
  const signature = Buffer.from(encodedSignature, 'base64url');
  if (!crypto.verify(null, signingInput, publicKey, signature)) throw unauthorized('Bad signature');

  if (await isDenied(payload.jti)) throw unauthorized('Token revoked');

  return payload;
}

/**
 * Signs an account JWT (dev/test helper; production signing lives in auth-module).
 *
 * @param {object} payload - JWT claims.
 * @param {object} privateJwk - Ed25519 private key (JWK).
 * @param {string} kid - Key id.
 * @returns {string} Signed JWT.
 */
function signAccountToken(payload, privateJwk, kid) {
  const header = { alg: 'EdDSA', typ: 'at+jwt', kid };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  const signature = crypto.sign(null, Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'), privateKey);
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

module.exports = { verifyAccountToken, signAccountToken };
