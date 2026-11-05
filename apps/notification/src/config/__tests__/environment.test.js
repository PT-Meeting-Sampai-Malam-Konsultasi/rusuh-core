const { loadEnvironment } = require('../environment');

describe('loadEnvironment', () => {
  it('defaults the port for this service', () => {
    expect(loadEnvironment({}).port).toBe(8084);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnvironment({ PORT: 'not-a-port' })).toThrow('Invalid environment configuration');
  });
});
