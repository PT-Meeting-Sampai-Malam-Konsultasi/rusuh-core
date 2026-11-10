const { createResponseMiddleware } = require('../response');

function mockResponse({ skipEnvelope = false, headersSent = false } = {}) {
  const handlers = {};
  const response = {
    headersSent,
    locals: { skipResponseEnvelope: skipEnvelope },
    statusCode: 200,
    sent: undefined,
    statusCalls: [],
    on(event, handler) {
      handlers[event] = handler;
      return this;
    },
    emit(event, ...args) {
      if (handlers[event]) handlers[event](...args);
      return this;
    },
    status(code) {
      this.statusCalls.push(code);
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.sent = payload;
      return this;
    }
  };
  return response;
}

function chainableLogger() {
  const logger = {
    addTags: jest.fn(() => logger),
    addData: jest.fn(() => logger),
    info: jest.fn()
  };
  return logger;
}

describe('createResponseMiddleware', () => {
  it('calls next() and leaves the original send untouched until send is called', () => {
    const middleware = createResponseMiddleware({});
    const request = {};
    const response = mockResponse();
    const next = jest.fn();
    middleware(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.sent).toBeUndefined();
  });

  it('sends the raw payload when the envelope is skipped', () => {
    const middleware = createResponseMiddleware({});
    const response = mockResponse({ skipEnvelope: true });
    middleware({}, response, () => {});
    response.send({ data: 1 });
    expect(response.sent).toEqual({ data: 1 });
  });

  it('sends the raw payload when headers were already sent or the payload is a Buffer', () => {
    const middleware = createResponseMiddleware({});
    const sent = mockResponse({ headersSent: true });
    middleware({}, sent, () => {});
    sent.send({ data: 1 });
    expect(sent.sent).toEqual({ data: 1 });

    const buffered = mockResponse();
    middleware({}, buffered, () => {});
    const payload = Buffer.from('binary');
    buffered.send(payload);
    expect(buffered.sent).toBe(payload);
  });

  it('applies the envelope path when it is not skipped (platform absent)', async () => {
    const middleware = createResponseMiddleware({});
    const response = mockResponse();
    middleware({}, response, () => {});
    response.send({ data: 1, statusCode: 201, message: 'created' });
    // The envelope path is async (Promise.resolve().then()).
    await Promise.resolve();
    await Promise.resolve();
    expect(response.statusCalls).toContain(201);
    expect(response.sent).toBe('created');
  });

  it('uses the platform unifyResponse result when present', async () => {
    const platform = {
      unifyResponse: jest.fn(async () => ({ statusCode: 202, bodyResponse: { normalized: true } }))
    };
    const middleware = createResponseMiddleware({ platform });
    const response = mockResponse();
    middleware({}, response, () => {});
    response.send({ data: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(platform.unifyResponse).toHaveBeenCalledTimes(1);
    expect(response.statusCalls).toContain(202);
    expect(response.sent).toEqual({ normalized: true });
  });

  it('forwards a unifyResponse failure to next()', async () => {
    const platform = {
      unifyResponse: jest.fn(async () => {
        throw new Error('unify down');
      })
    };
    const middleware = createResponseMiddleware({ platform });
    const response = mockResponse();
    const next = jest.fn();
    middleware({}, response, next);
    response.send({ data: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('logs completion once on finish, and never throws when logging fails', () => {
    const logger = chainableLogger();
    const platform = {
      LoggerBuilder: { getLogger: () => logger, getMetadataFromRequest: () => ({ requestId: 'r-1' }) },
      logRequest: jest.fn(() => ({ route: '/sys/ping' }))
    };
    const middleware = createResponseMiddleware({ platform });
    const response = mockResponse();
    response.statusCode = 200;
    middleware({ method: 'GET', url: '/sys/ping' }, response, () => {});
    response.emit('finish');
    response.emit('finish');
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('API request completed');
    // statusCode is passed to logRequest (and merged via logData), not
    // added separately to addData.
    expect(platform.logRequest).toHaveBeenCalledWith(expect.anything(), { statusCode: 200 });
    expect(logger.addData).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r-1', route: '/sys/ping' }));

    // A logger that throws must not break the request lifecycle.
    const throwing = {
      LoggerBuilder: {
        getLogger: () => {
          throw new Error('logger down');
        }
      }
    };
    const failing = createResponseMiddleware({ platform: throwing });
    const failingResponse = mockResponse();
    failing({}, failingResponse, () => {});
    expect(() => failingResponse.emit('finish')).not.toThrow();
  });

  it('does not log on finish when no platform is injected', () => {
    const middleware = createResponseMiddleware({});
    const response = mockResponse();
    middleware({}, response, () => {});
    expect(() => response.emit('finish')).not.toThrow();
  });
});
