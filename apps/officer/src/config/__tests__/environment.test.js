const { loadEnvironment } = require('../environment');

describe('loadEnvironment', () => {
  it('defaults the port for this service', () => {
    expect(loadEnvironment({}).port).toBe(8085);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnvironment({ PORT: 'not-a-port' })).toThrow('Invalid environment configuration');
  });

  it('defaults database/auth config to null (fail-closed at runtime)', () => {
    const config = loadEnvironment({});
    expect(config.databaseUrl).toBeNull();
    expect(config.nikEncryptionKey).toBeNull();
    expect(config.authPublicKeys).toBeNull();
  });

  it('parses AUTH_PUBLIC_KEYS_JSON into a Map', () => {
    const jwk = { kty: 'OKP', crv: 'Ed25519', x: 'abc' };
    const config = loadEnvironment({ AUTH_PUBLIC_KEYS_JSON: JSON.stringify({ 'akun-202611-01': jwk }) });
    expect(config.authPublicKeys).toBeInstanceOf(Map);
    expect(config.authPublicKeys.get('akun-202611-01')).toEqual(jwk);
  });

  it('rejects malformed AUTH_PUBLIC_KEYS_JSON', () => {
    expect(() => loadEnvironment({ AUTH_PUBLIC_KEYS_JSON: 'not-json' })).toThrow('Invalid environment configuration');
  });
});
