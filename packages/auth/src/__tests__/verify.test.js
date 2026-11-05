const crypto = require('crypto');
const { verifyAccountToken, signAccountToken } = require('../verify');

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicJwk: publicKey.export({ format: 'jwk' }),
    privateJwk: privateKey.export({ format: 'jwk' })
  };
}

describe('verifyAccountToken', () => {
  it('verifies a token signed by the known key', async () => {
    const { publicJwk, privateJwk } = keypair();
    const publicKeys = new Map([['akun-202611-01', publicJwk]]);
    const payload = { sub: 'acc_01', iat: 1000, exp: 1000 + 900, jti: 'jti-1', aud: 'rusuh-api' };
    const token = signAccountToken(payload, privateJwk, 'akun-202611-01');
    const decoded = await verifyAccountToken(token, { publicKeys, expectedAud: 'rusuh-api', nowSec: 1000 });
    expect(decoded.sub).toBe('acc_01');
  });

  it('rejects a bad signature', async () => {
    const { publicJwk } = keypair();
    const other = keypair();
    const publicKeys = new Map([['akun-202611-01', publicJwk]]);
    const payload = { sub: 'acc_01', iat: 1000, exp: 1000 + 900, jti: 'jti-1' };
    const token = signAccountToken(payload, other.privateJwk, 'akun-202611-01');
    await expect(verifyAccountToken(token, { publicKeys, nowSec: 1000 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    });
  });

  it('rejects an expired token and a denylisted jti', async () => {
    const { publicJwk, privateJwk } = keypair();
    const publicKeys = new Map([['akun-202611-01', publicJwk]]);
    const payload = { sub: 'acc_01', iat: 1000, exp: 1000 + 900, jti: 'jti-1' };
    const token = signAccountToken(payload, privateJwk, 'akun-202611-01');
    await expect(verifyAccountToken(token, { publicKeys, nowSec: 1000 + 900 + 61 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    });
    await expect(
      verifyAccountToken(token, { publicKeys, nowSec: 1000, isDenied: async () => true })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
