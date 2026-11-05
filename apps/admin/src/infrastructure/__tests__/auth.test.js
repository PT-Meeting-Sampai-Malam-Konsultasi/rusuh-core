const crypto = require('crypto');
const { signAccountToken } = require('@rusuh/auth');
const { createVerifier } = require('@/infrastructure/auth');

function keypair(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    kid,
    publicJwk: { ...publicKey.export({ format: 'jwk' }), kid },
    privateJwk: privateKey.export({ format: 'jwk' })
  };
}

describe('createVerifier', () => {
  const nowSec = () => Math.floor(Date.now() / 1000);

  it('verifies a token against a JWK from AUTH_PUBLIC_KEY_JWK', async () => {
    const { kid, publicJwk, privateJwk } = keypair('akun-202611-01');
    const verifier = createVerifier({ jwksJson: JSON.stringify(publicJwk) });
    const now = nowSec();
    const token = signAccountToken({ sub: 'acc_admin_01', iat: now, exp: now + 900, jti: 'jti-1' }, privateJwk, kid);
    const payload = await verifier.verify(token);
    expect(payload.sub).toBe('acc_admin_01');
  });

  it('rejects a token signed by an unknown key', async () => {
    const known = keypair('akun-202611-01');
    const other = keypair('akun-202611-01');
    const verifier = createVerifier({ jwksJson: JSON.stringify(known.publicJwk) });
    const now = nowSec();
    const token = signAccountToken(
      { sub: 'acc_admin_01', iat: now, exp: now + 900, jti: 'jti-1' },
      other.privateJwk,
      known.kid
    );
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects every token when no keys are configured (fail-closed)', async () => {
    const verifier = createVerifier({});
    await expect(verifier.verify('x.y.z')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('loads keys from a JWKS URL', async () => {
    const { kid, publicJwk, privateJwk } = keypair('akun-202611-01');
    const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [publicJwk] }) });
    const verifier = createVerifier({ jwksUrl: 'https://auth.internal.rusuh.id/.well-known/jwks.json', fetchImpl });
    const now = nowSec();
    const token = signAccountToken({ sub: 'acc_admin_01', iat: now, exp: now + 900, jti: 'jti-1' }, privateJwk, kid);
    const payload = await verifier.verify(token);
    expect(payload.sub).toBe('acc_admin_01');
  });
});
