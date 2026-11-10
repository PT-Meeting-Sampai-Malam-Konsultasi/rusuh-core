const crypto = require('crypto');
const { signAccountToken } = require('@rusuh/auth');
const { createDefaultVerifyToken, createPostgresRoleResolver } = require('../auth-provider');

describe('createDefaultVerifyToken', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const kid = 'test-kid-1';
  const publicJwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  const nowSec = Math.floor(Date.now() / 1000);

  const sign = (overrides = {}) =>
    signAccountToken(
      { sub: 'acc_officer_1', iat: nowSec, exp: nowSec + 900, jti: 'jti-1', ...overrides },
      privateJwk,
      kid
    );

  it('verifies a real Ed25519 account JWT and returns the payload', async () => {
    const verifyToken = createDefaultVerifyToken({
      authPublicKeys: new Map([[kid, publicJwk]]),
      authAudience: 'rusuh-api',
      authIssuer: 'rusuh-auth'
    });
    const token = sign({ aud: 'rusuh-api', iss: 'rusuh-auth' });
    const payload = await verifyToken(token);
    expect(payload.sub).toBe('acc_officer_1');
    expect(payload.jti).toBe('jti-1');
  });

  it('throws 401 UNAUTHORIZED when no public keys are configured', async () => {
    const verifyToken = createDefaultVerifyToken({ authPublicKeys: null });
    await expect(verifyToken('anything')).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  it('throws 401 UNAUTHORIZED when the public key set is empty', async () => {
    const verifyToken = createDefaultVerifyToken({ authPublicKeys: new Map() });
    await expect(verifyToken('anything')).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  it('throws 401 UNAUTHORIZED for a malformed token', async () => {
    const verifyToken = createDefaultVerifyToken({ authPublicKeys: new Map([[kid, publicJwk]]) });
    await expect(verifyToken('not-a-jwt')).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  it('throws 401 UNAUTHORIZED for a bad signature', async () => {
    const verifyToken = createDefaultVerifyToken({ authPublicKeys: new Map([[kid, publicJwk]]) });
    const token = sign();
    const tampered = `${token.slice(0, -2)}xx`;
    await expect(verifyToken(tampered)).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  it('throws 401 UNAUTHORIZED for a wrong audience', async () => {
    const verifyToken = createDefaultVerifyToken({
      authPublicKeys: new Map([[kid, publicJwk]]),
      authAudience: 'rusuh-api'
    });
    const token = sign({ aud: 'other-api' });
    await expect(verifyToken(token)).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  it('throws 401 UNAUTHORIZED for a denylisted jti (Q42 logout revocation)', async () => {
    const denylist = { isDenied: async (jti) => jti === 'jti-logged-out' };
    const verifyToken = createDefaultVerifyToken({ authPublicKeys: new Map([[kid, publicJwk]]) }, denylist);
    const token = sign({ jti: 'jti-logged-out' });
    await expect(verifyToken(token)).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
    // A live jti on the same key still verifies.
    await expect(verifyToken(sign({ jti: 'jti-live' }))).resolves.toMatchObject({ sub: 'acc_officer_1' });
  });

  it('fails closed with 503 SERVICE_UNAVAILABLE when the denylist is unreachable', async () => {
    const denylist = {
      isDenied: async () => {
        const error = new Error('connection refused');
        error.code = 'DENYLIST_UNAVAILABLE';
        throw error;
      }
    };
    const verifyToken = createDefaultVerifyToken({ authPublicKeys: new Map([[kid, publicJwk]]) }, denylist);
    await expect(verifyToken(sign())).rejects.toMatchObject({
      data: { code: 'SERVICE_UNAVAILABLE' },
      status: 503
    });
  });
});

describe('createPostgresRoleResolver', () => {
  it('returns the role from the accounts table', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ role: 'officer' }] }) };
    const resolveRole = createPostgresRoleResolver(pool);
    await expect(resolveRole('acc_officer_1')).resolves.toBe('officer');
    expect(pool.query).toHaveBeenCalledWith('SELECT role FROM accounts WHERE id = $1', ['acc_officer_1']);
  });

  it('returns null when the account does not exist', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const resolveRole = createPostgresRoleResolver(pool);
    await expect(resolveRole('acc_missing')).resolves.toBeNull();
  });
});
