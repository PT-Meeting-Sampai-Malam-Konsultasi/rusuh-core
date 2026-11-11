const crypto = require('crypto');
const request = require('supertest');
const { verifyAccountToken } = require('@rusuh/auth');
const { createTestApp, loginViaOtp } = require('@/test-helpers');

describe('GET /.well-known/jwks.json', () => {
  let app;
  let dependencies;
  let privateJwk;

  beforeEach(() => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    privateJwk = privateKey.export({ format: 'jwk' });
    ({ app, dependencies } = createTestApp({
      AUTH_JWT_PRIVATE_KEY_JWK: JSON.stringify(privateJwk),
      AUTH_JWT_KID: 'test-kid-1'
    }));
  });

  afterEach(async () => {
    await dependencies.store.close();
  });

  it('serves the public keys only (no "d") for the configured kid', async () => {
    const response = await request(app).get('/.well-known/jwks.json');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('max-age=300');
    expect(response.body.keys).toHaveLength(1);
    const jwk = response.body.keys[0];
    expect(jwk.kid).toBe('test-kid-1');
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
    expect(typeof jwk.x).toBe('string');
    // The x served is the one derived from the private key (not a copy of
    // any fixture value) and the private scalar never leaves the service.
    expect(jwk.x).toBe(crypto.createPublicKey({ key: privateJwk, format: 'jwk' }).export({ format: 'jwk' }).x);
    expect(jwk.d).toBeUndefined();
  });

  it('serves a key that actually verifies a freshly signed token (queue consumer path)', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'jwks@example.com');
    const { body } = await request(app).get('/.well-known/jwks.json');
    const publicKeys = new Map(body.keys.map((jwk) => [jwk.kid, jwk]));

    // Same verification path rusuh-queue runs against CORE_JWKS_URL.
    const payload = await verifyAccountToken(session.accessToken, {
      publicKeys,
      expectedAud: 'rusuh-api',
      expectedIss: 'rusuh-auth'
    });
    expect(payload.sub).toBe(session.user.userId);
  });

  it('answers with an empty key set (not 500) when nothing is configured', async () => {
    const bare = createTestApp();
    const response = await request(bare.app).get('/.well-known/jwks.json');
    expect(response.status).toBe(200);
    expect(response.body.keys).toBeInstanceOf(Array);
    await bare.dependencies.store.close();
  });
});
