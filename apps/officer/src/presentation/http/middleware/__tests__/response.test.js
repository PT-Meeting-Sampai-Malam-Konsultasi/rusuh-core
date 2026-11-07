const { createResponseMiddleware } = require('../response');

function makePlatform({ throwOnLogger = false, unifyResponse = undefined } = {}) {
  const logger = {
    addTags: jest.fn(() => logger),
    addData: jest.fn(() => logger),
    info: jest.fn(),
    error: jest.fn()
  };
  return {
    logger,
    LoggerBuilder: {
      getLogger: throwOnLogger
        ? () => {
            throw new Error('logger down');
          }
        : () => logger,
      getMetadataFromRequest: () => ({ requestId: 'req_1' })
    },
    logRequest: jest.fn(() => ({})),
    unifyResponse: jest.fn(() => unifyResponse)
  };
}

function makeResponse() {
  const handlers = {};
  const response = {
    locals: {},
    statusCode: 200,
    headersSent: false,
    sentPayload: undefined,
    statusCalls: [],
    on(event, handler) {
      handlers[event] = handler;
      return this;
    },
    emit(event) {
      if (handlers[event]) handlers[event]();
    },
    status(code) {
      this.statusCalls.push(code);
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.sentPayload = payload;
      return this;
    }
  };
  return response;
}

describe('createResponseMiddleware', () => {
  it('requires platform', () => {
    expect(() => createResponseMiddleware({})).toThrow('createResponseMiddleware requires platform');
    expect(() => createResponseMiddleware()).toThrow('createResponseMiddleware requires platform');
  });

  it('calls next and logs once on finish', async () => {
    const platform = makePlatform();
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    const next = jest.fn();
    middleware({}, response, next);
    expect(next).toHaveBeenCalledTimes(1);

    response.emit('finish');
    // The second finish must be a no-op (responseLogged guard).
    response.emit('finish');
    expect(platform.logger.info).toHaveBeenCalledTimes(1);
    expect(platform.logger.info).toHaveBeenCalledWith('API request completed');
  });

  it('does not break the request when logging throws on finish', () => {
    const platform = makePlatform({ throwOnLogger: true });
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    middleware({}, response, jest.fn());
    expect(() => response.emit('finish')).not.toThrow();
  });

  it('sends a Buffer payload straight through (no envelope)', () => {
    const platform = makePlatform();
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    middleware({}, response, jest.fn());
    const buffer = Buffer.from('raw');
    const returned = response.send(buffer);
    expect(returned).toBe(response);
    expect(response.sentPayload).toBe(buffer);
    expect(platform.unifyResponse).not.toHaveBeenCalled();
  });

  it('sends straight through when skipResponseEnvelope is set', () => {
    const platform = makePlatform();
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    response.locals.skipResponseEnvelope = true;
    middleware({}, response, jest.fn());
    response.send({ data: 'x' });
    expect(response.sentPayload).toEqual({ data: 'x' });
    expect(platform.unifyResponse).not.toHaveBeenCalled();
  });

  it('normalizes a JSON payload through unifyResponse', async () => {
    const platform = makePlatform({ unifyResponse: { bodyResponse: { data: 'x' }, statusCode: 200 } });
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    middleware({}, response, jest.fn());
    response.send({ data: 'x' });
    // unifyResponse runs async (Promise.resolve().then).
    await Promise.resolve();
    await Promise.resolve();
    expect(platform.unifyResponse).toHaveBeenCalledTimes(1);
    expect(response.sentPayload).toEqual({ data: 'x' });
  });

  it('forwards a unifyResponse failure to next', async () => {
    const platform = makePlatform();
    platform.unifyResponse.mockRejectedValue(new Error('unify down'));
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    const next = jest.fn();
    middleware({}, response, next);
    response.send({ data: 'x' });
    await Promise.resolve();
    await Promise.resolve();
    // next() is called once by the middleware itself (normal flow) and once
    // by the .catch(next) with the error.
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unify down' }));
  });
});
