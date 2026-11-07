const { loadEnvironment } = require('../environment');

describe('loadEnvironment', () => {
  it('defaults the port for this service', () => {
    expect(loadEnvironment({}).port).toBe(8083);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnvironment({ PORT: 'not-a-port' })).toThrow('Invalid environment configuration');
  });

  it('defaults to the memory store without a DATABASE_URL and to Postgres with one', () => {
    expect(loadEnvironment({}).paymentStore).toBe('memory');
    expect(loadEnvironment({ DATABASE_URL: 'postgres://localhost:5432/rusuh' }).paymentStore).toBe('postgres');
    expect(
      loadEnvironment({ DATABASE_URL: 'postgres://localhost:5432/rusuh', PAYMENT_STORE: 'memory' }).paymentStore
    ).toBe('memory');
  });

  it('defaults Midtrans to the sandbox and the webhook body limit to 64 KB', () => {
    const config = loadEnvironment({});
    expect(config.midtrans.snapBaseUrl).toBe('https://app.sandbox.midtrans.com/snap');
    expect(config.midtrans.apiBaseUrl).toBe('https://api.sandbox.midtrans.com');
    expect(config.webhookBodyLimitBytes).toBe(65536);
    expect(config.getStatusMaxRetries).toBe(3);
    expect(config.core.notifyTimeoutMs).toBe(5000);
  });

  it('rejects an invalid PAYMENT_STORE', () => {
    expect(() => loadEnvironment({ PAYMENT_STORE: 'redis' })).toThrow('Invalid environment configuration');
  });
});
