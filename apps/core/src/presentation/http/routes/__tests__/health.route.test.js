const { createHealthUseCase } = require('@/application/health/health.use-case');

describe('health use case', () => {
  test('reports live status', () => {
    expect(createHealthUseCase().live()).toEqual({ status: 'ok' });
  });

  test('reports unavailable readiness', async () => {
    const useCase = createHealthUseCase({ isReady: async () => false });
    await expect(useCase.ready()).resolves.toEqual({ status: 'not_ready' });
  });
});
