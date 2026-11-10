const { buildPaymentDeps } = require('../container');

function buildConfig({ serverKey = '' } = {}) {
  return {
    paymentStore: 'memory',
    databaseUrl: '',
    midtrans: {
      serverKey,
      snapBaseUrl: 'https://app.sandbox.midtrans.com/snap',
      apiBaseUrl: 'https://api.sandbox.midtrans.com'
    },
    core: {
      internalUrl: 'http://localhost:8082',
      serviceCredential: '',
      notifyTimeoutMs: 5000,
      notifyMaxRetries: 3,
      notifyRetryBaseMs: 200
    },
    getStatusMaxRetries: 3,
    getStatusRetryBaseMs: 200
  };
}

describe('buildPaymentDeps (composition root)', () => {
  it('builds all use cases when a Midtrans Server Key is present', () => {
    const deps = buildPaymentDeps(buildConfig({ serverKey: 'sk-test' }));
    expect(deps.midtransClient).not.toBeNull();
    expect(deps.coreClient).toBeDefined();
    expect(deps.snapUseCase).not.toBeNull();
    expect(deps.statusUseCase).not.toBeNull();
    expect(deps.webhookUseCase).not.toBeNull();
    expect(deps.store).toBeDefined();
    expect(deps.metrics).toBeDefined();
    expect(deps.logger).toBeDefined();
    expect(typeof deps.snapUseCase.createSnapTransaction).toBe('function');
    expect(typeof deps.statusUseCase.confirmViaGetStatus).toBe('function');
    expect(typeof deps.webhookUseCase.processNotification).toBe('function');
  });

  it('fails closed without a Server Key: no Midtrans client and no use cases', () => {
    const deps = buildPaymentDeps(buildConfig({ serverKey: '' }));
    expect(deps.midtransClient).toBeNull();
    expect(deps.snapUseCase).toBeNull();
    expect(deps.statusUseCase).toBeNull();
    expect(deps.webhookUseCase).toBeNull();
    // The store and the core client are still built (health + store work).
    expect(deps.store).toBeDefined();
    expect(deps.coreClient).toBeDefined();
  });

  it('uses the injected overrides instead of building adapters', () => {
    const store = { fake: 'store' };
    const midtransClient = { fake: 'midtrans' };
    const coreClient = { fake: 'core' };
    const snapUseCase = { fake: 'snap' };
    const statusUseCase = { fake: 'status' };
    const webhookUseCase = { fake: 'webhook' };
    const logger = { fake: 'logger' };
    const metrics = { fake: 'metrics' };
    const deps = buildPaymentDeps(buildConfig({ serverKey: 'sk-test' }), {
      store,
      midtransClient,
      coreClient,
      snapUseCase,
      statusUseCase,
      webhookUseCase,
      logger,
      metrics
    });
    expect(deps.store).toBe(store);
    expect(deps.midtransClient).toBe(midtransClient);
    expect(deps.coreClient).toBe(coreClient);
    expect(deps.snapUseCase).toBe(snapUseCase);
    expect(deps.statusUseCase).toBe(statusUseCase);
    expect(deps.webhookUseCase).toBe(webhookUseCase);
    expect(deps.logger).toBe(logger);
    expect(deps.metrics).toBe(metrics);
  });
});
