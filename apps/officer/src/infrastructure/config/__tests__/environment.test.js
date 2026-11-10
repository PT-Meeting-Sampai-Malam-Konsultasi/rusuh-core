const { loadEnvironment, parseCorsOrigins, DEFAULT_CORS_ORIGINS } = require('../environment');

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

  it('rejects AUTH_PUBLIC_KEYS_JSON that is not an object', () => {
    expect(() => loadEnvironment({ AUTH_PUBLIC_KEYS_JSON: '[]' })).toThrow('must be an object');
    expect(() => loadEnvironment({ AUTH_PUBLIC_KEYS_JSON: '"just-a-string"' })).toThrow('must be an object');
    expect(() => loadEnvironment({ AUTH_PUBLIC_KEYS_JSON: '42' })).toThrow('must be an object');
  });

  it('defaults CORS origins when CORS_ORIGINS is unset or empty', () => {
    expect(loadEnvironment({}).corsOrigins).toEqual(DEFAULT_CORS_ORIGINS);
    expect(loadEnvironment({ CORS_ORIGINS: '' }).corsOrigins).toEqual(DEFAULT_CORS_ORIGINS);
    expect(loadEnvironment({ CORS_ORIGINS: ' ,  ' }).corsOrigins).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('parses a comma-separated CORS_ORIGINS list (trimmed, empties dropped)', () => {
    const config = loadEnvironment({
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com ,, http://localhost:3000 '
    });
    expect(config.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com', 'http://localhost:3000']);
  });
});

describe('parseCorsOrigins', () => {
  it('returns the defaults for undefined, empty and whitespace-only input', () => {
    expect(parseCorsOrigins(undefined)).toEqual(DEFAULT_CORS_ORIGINS);
    expect(parseCorsOrigins('')).toEqual(DEFAULT_CORS_ORIGINS);
    expect(parseCorsOrigins('   ')).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('returns a copy of the defaults (mutating the result must not affect the constant)', () => {
    const parsed = parseCorsOrigins('');
    parsed.push('https://evil.example.com');
    expect(DEFAULT_CORS_ORIGINS).not.toContain('https://evil.example.com');
  });
});

describe('DEFAULT_CORS_ORIGINS', () => {
  it('includes the production web and the local dev frontends', () => {
    expect(DEFAULT_CORS_ORIGINS).toEqual([
      'https://rusuh-tiket.web.id',
      'https://www.rusuh-tiket.web.id',
      'http://localhost:3000',
      'http://localhost:5173'
    ]);
  });
});
