const { createHealthService } = require('@/modules/health/health.service');

describe('health service', () => {
  test('reports live status', () => {
    expect(createHealthService().live()).toEqual({ status: 'ok' });
  });

  test('reports unavailable readiness', async () => {
    const service = createHealthService({ isReady: async () => false });
    await expect(service.ready()).resolves.toEqual({ status: 'not_ready' });
  });
});
