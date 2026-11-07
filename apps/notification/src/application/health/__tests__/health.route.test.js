const { createHealthUseCase } = require('@/application/health/health.use-case');
const { createHealthController } = require('@/presentation/http/controllers/health.controller');

function mockResponse() {
  const response = {
    locals: {},
    statusCode: 200,
    status: jest.fn((code) => {
      response.statusCode = code;
      return response;
    }),
    json: jest.fn(() => response),
    type: jest.fn(() => response),
    send: jest.fn(() => response)
  };
  return response;
}

describe('health service', () => {
  test('reports live status', () => {
    expect(createHealthUseCase().live()).toEqual({ status: 'ok' });
  });

  test('reports unavailable readiness', async () => {
    const service = createHealthUseCase({ isReady: async () => false });
    await expect(service.ready()).resolves.toEqual({ status: 'not_ready' });
  });
});

describe('health controller', () => {
  test('ping returns ok as plain text', () => {
    const controller = createHealthController(createHealthUseCase());
    const response = mockResponse();
    controller.ping({}, response);
    expect(response.locals.skipResponseEnvelope).toBe(true);
    expect(response.send).toHaveBeenCalledWith('ok');
  });

  test('live returns 200 with ok', () => {
    const controller = createHealthController(createHealthUseCase());
    const response = mockResponse();
    controller.live({}, response);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ status: 'ok' });
  });

  test('ready returns 200 when ready and 503 when not ready', async () => {
    const readyController = createHealthController(createHealthUseCase({ isReady: async () => true }));
    const readyResponse = mockResponse();
    await readyController.ready({}, readyResponse);
    expect(readyResponse.status).toHaveBeenCalledWith(200);
    expect(readyResponse.json).toHaveBeenCalledWith({ status: 'ready' });

    const notReadyController = createHealthController(createHealthUseCase({ isReady: async () => false }));
    const notReadyResponse = mockResponse();
    await notReadyController.ready({}, notReadyResponse);
    expect(notReadyResponse.status).toHaveBeenCalledWith(503);
    expect(notReadyResponse.json).toHaveBeenCalledWith({ status: 'not_ready' });
  });
});
