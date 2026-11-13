const { DEFAULT_CORS_ORIGINS } = require('@rusuh/http');
const { loadEnvironment } = require('../environment');

describe('loadEnvironment', () => {
  it('defaults the port for this service', () => {
    expect(loadEnvironment({}).port).toBe(8082);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnvironment({ PORT: 'not-a-port' })).toThrow('Invalid environment configuration');
  });

  it('defaults CORS_ORIGINS to the production web + local dev origins', () => {
    expect(loadEnvironment({}).corsOrigins).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('parses a comma-separated CORS_ORIGINS into an array', () => {
    const config = loadEnvironment({ CORS_ORIGINS: 'https://a.example.com,https://b.example.com' });
    expect(config.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('trims whitespace and drops empty CORS_ORIGINS entries', () => {
    const config = loadEnvironment({ CORS_ORIGINS: '  https://a.example.com , , https://b.example.com  ' });
    expect(config.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('falls back to the defaults when CORS_ORIGINS is empty', () => {
    expect(loadEnvironment({ CORS_ORIGINS: '' }).corsOrigins).toEqual(DEFAULT_CORS_ORIGINS);
    expect(loadEnvironment({ CORS_ORIGINS: '   ' }).corsOrigins).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('rejects invalid telemetry configuration before server startup', () => {
    expect(() => loadEnvironment({ OTEL_TRACES_EXPORTER: 'stdout' })).toThrow('Invalid environment configuration');
    expect(() => loadEnvironment({ OTEL_TRACES_SAMPLER_ARG: '2' })).toThrow('Invalid environment configuration');
  });
});
