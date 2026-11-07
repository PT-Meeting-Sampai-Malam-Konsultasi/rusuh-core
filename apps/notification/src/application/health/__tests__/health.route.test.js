const { createHealthUseCase } = require('@/application/health/health.use-case');

describe('health service', () => {
  test('reports live status', () => {
    expect(createHealthUseCase().live()).toEqual({ status: 'ok' });
  });

  test('reports unavailable readiness', async () => {
    const service = createHealthUseCase({ isReady: async () => false });
    await expect(service.ready()).resolves.toEqual({ status: 'not_ready' });
  });
});
