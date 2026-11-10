const { createHealthController } = require('../health.controller');

function makeResponse() {
  const response = {
    locals: {},
    statusCode: null,
    body: null,
    textBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    type() {
      return this;
    },
    send(body) {
      this.textBody = body;
      return this;
    }
  };
  return response;
}

describe('createHealthController', () => {
  it('ping returns plain ok', () => {
    const controller = createHealthController({
      live: () => ({ status: 'ok' }),
      ready: async () => ({ status: 'ready' })
    });
    const response = makeResponse();
    controller.ping({}, response);
    expect(response.textBody).toBe('ok');
    expect(response.locals.skipResponseEnvelope).toBe(true);
  });

  it('live returns the live status', () => {
    const controller = createHealthController({
      live: () => ({ status: 'ok' }),
      ready: async () => ({ status: 'ready' })
    });
    const response = makeResponse();
    controller.live({}, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('ready returns 200 when the service is ready', async () => {
    const controller = createHealthController({
      live: () => ({ status: 'ok' }),
      ready: async () => ({ status: 'ready' })
    });
    const response = makeResponse();
    await controller.ready({}, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
  });

  it('ready returns 503 when the service is not ready', async () => {
    const controller = createHealthController({
      live: () => ({ status: 'ok' }),
      ready: async () => ({ status: 'not_ready' })
    });
    const response = makeResponse();
    await controller.ready({}, response);
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
  });
});
