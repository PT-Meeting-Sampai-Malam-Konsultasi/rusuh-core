const { DEFAULT_CORS_ORIGINS } = require('@rusuh/http');
const { loadEnvironment } = require('../environment');

describe('loadEnvironment', () => {
  it('defaults the port for this service', () => {
    expect(loadEnvironment({}).port).toBe(8081);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnvironment({ PORT: 'not-a-port' })).toThrow('Invalid environment configuration');
  });

  it('defaults CORS origins to the production domains + local dev origins', () => {
    expect(loadEnvironment({}).corsOrigins).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('defaults CORS origins when the value is empty', () => {
    expect(loadEnvironment({ CORS_ORIGINS: '' }).corsOrigins).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('parses a comma-separated CORS_ORIGINS list (trims, drops empties)', () => {
    expect(loadEnvironment({ CORS_ORIGINS: 'https://a.example.com, https://b.example.com,, ' }).corsOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com'
    ]);
  });
});
