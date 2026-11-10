const { createHealthUseCase } = require('@/application/health/health.use-case');

describe('health use case', () => {
  test('reports live status', () => {
    expect(createHealthUseCase().live()).toEqual({ status: 'ok' });
  });

  test('reports unavailable readiness', async () => {
    const useCase = createHealthUseCase({ isReady: async () => false });
    await expect(useCase.ready()).resolves.toEqual({ status: 'not_ready' });
  });

  test('readyz reports ok while serving', () => {
    expect(createHealthUseCase().readyz()).toEqual({ status: 'ok' });
  });

  test('readyz reports not_ready once shutdown has started', () => {
    const useCase = createHealthUseCase({ isShuttingDown: () => true });
    expect(useCase.readyz()).toEqual({ status: 'not_ready' });
  });
});
