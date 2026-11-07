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
