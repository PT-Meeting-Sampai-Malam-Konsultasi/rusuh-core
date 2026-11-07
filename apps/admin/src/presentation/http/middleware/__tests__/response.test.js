const { EventEmitter } = require('events');
const { createResponseMiddleware } = require('../response');

function makePlatform(overrides = {}) {
  const logger = {
    addTags: jest.fn(() => logger),
    addData: jest.fn(() => logger),
    error: jest.fn(),
    info: jest.fn()
  };
  return {
    logger,
    LoggerBuilder: {
      getLogger: jest.fn(() => logger),
      getMetadataFromRequest: jest.fn(() => ({}))
    },
    logRequest: jest.fn(() => ({})),
    unifyResponse: jest.fn(() => undefined),
    ...overrides
  };
}

function makeResponse() {
  const response = new EventEmitter();
  response.locals = {};
  response.headersSent = false;
  response.statusCode = 200;
  response.send = jest.fn();
  response.status = jest.fn(() => response);
  return response;
}

const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

describe('createResponseMiddleware', () => {
  it('throws when no platform is provided', () => {
    expect(() => createResponseMiddleware()).toThrow('createResponseMiddleware requires platform');
    expect(() => createResponseMiddleware({})).toThrow('createResponseMiddleware requires platform');
  });

  it('calls next() and leaves the response usable', () => {
    const middleware = createResponseMiddleware({ platform: makePlatform() });
    const next = jest.fn();
    middleware({}, makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes the payload through unchanged when the envelope is skipped', async () => {
    const platform = makePlatform();
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    const originalSend = response.send;
    response.locals.skipResponseEnvelope = true;
    const next = jest.fn();
    middleware({}, response, next);
    const payload = { data: { id: 'evt_1' } };
    response.send(payload);
    await flush();
    expect(originalSend).toHaveBeenCalledWith(payload);
    expect(platform.unifyResponse).not.toHaveBeenCalled();
  });

  it('passes the payload through unchanged when the headers are already sent', async () => {
    const platform = makePlatform();
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    const originalSend = response.send;
    response.headersSent = true;
    middleware({}, response, jest.fn());
    response.send({ data: 1 });
    await flush();
    expect(originalSend).toHaveBeenCalledTimes(1);
    expect(platform.unifyResponse).not.toHaveBeenCalled();
  });

  it('passes a Buffer payload through unchanged', async () => {
    const platform = makePlatform();
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    const originalSend = response.send;
    middleware({}, response, jest.fn());
    const payload = Buffer.from('binary', 'utf8');
    response.send(payload);
    await flush();
    expect(originalSend).toHaveBeenCalledWith(payload);
    expect(platform.unifyResponse).not.toHaveBeenCalled();
  });

  it('normalises a normal payload through unifyResponse and sends it', async () => {
    const platform = makePlatform({
      unifyResponse: jest.fn(() => ({ statusCode: 201, bodyResponse: { data: { id: 'evt_1' } } }))
    });
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    const originalSend = response.send;
    middleware({ method: 'POST' }, response, jest.fn());
    const payload = { data: { id: 'evt_1' } };
    response.send(payload);
    await flush();
    await flush();
    expect(platform.unifyResponse).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(originalSend).toHaveBeenCalledWith({ data: { id: 'evt_1' } });
  });

  it('falls back to the raw payload when unifyResponse returns undefined', async () => {
    const platform = makePlatform();
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    const originalSend = response.send;
    response.statusCode = 200;
    middleware({}, response, jest.fn());
    const payload = { data: { id: 'evt_1' } };
    response.send(payload);
    await flush();
    await flush();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(originalSend).toHaveBeenCalledWith(payload);
  });

  it('logs completion once on finish, and never twice', async () => {
    const platform = makePlatform();
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    middleware({}, response, jest.fn());
    response.emit('finish');
    response.emit('finish');
    await flush();
    expect(platform.logger.info).toHaveBeenCalledTimes(1);
    expect(platform.logger.info).toHaveBeenCalledWith('API request completed');
  });

  it('does not break the request lifecycle when logging throws', async () => {
    const platform = makePlatform();
    platform.LoggerBuilder.getLogger = jest.fn(() => {
      throw new Error('logger down');
    });
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    middleware({}, response, jest.fn());
    expect(() => response.emit('finish')).not.toThrow();
  });

  it('forwards a unifyResponse failure to next', async () => {
    const platform = makePlatform({
      unifyResponse: jest.fn(() => Promise.reject(new Error('unify down')))
    });
    const middleware = createResponseMiddleware({ platform });
    const response = makeResponse();
    const next = jest.fn();
    middleware({}, response, next);
    response.send({ data: 1 });
    await flush();
    await flush();
    // next() is called once by the middleware to continue the chain, and
    // once more by the .catch with the async failure.
    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[0]).toEqual([]);
    expect(next.mock.calls[1][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[1][0].message).toBe('unify down');
  });
});
