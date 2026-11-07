const Boom = require('@hapi/boom');
const { createResponseMiddleware } = require('../response');
const { createErrorHandler } = require('../error-handler');

function makeResponse(overrides = {}) {
  const response = {
    locals: {},
    headersSent: false,
    statusCode: 200,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    on: jest.fn(),
    ...overrides
  };
  return response;
}

describe('createResponseMiddleware', () => {
  it('passes a Buffer payload straight through to the original send', () => {
    const middleware = createResponseMiddleware({ platform: {} });
    const request = {};
    const response = makeResponse();
    const originalSend = response.send;
    const next = jest.fn();
    middleware(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    const payload = Buffer.from('{"a":1}');
    response.send(payload);
    expect(originalSend).toHaveBeenCalledWith(payload);
  });

  it('skips the envelope when locals.skipResponseEnvelope is set', () => {
    const middleware = createResponseMiddleware({ platform: {} });
    const request = {};
    const response = makeResponse({ locals: { skipResponseEnvelope: true } });
    const originalSend = response.send;
    middleware(request, response, jest.fn());
    response.send({ hello: 'world' });
    expect(originalSend).toHaveBeenCalledWith({ hello: 'world' });
  });

  it('normalizes the body through platform.unifyResponse', async () => {
    const platform = {
      unifyResponse: jest.fn().mockResolvedValue({ statusCode: 201, bodyResponse: { ok: true } })
    };
    const middleware = createResponseMiddleware({ platform });
    const request = {};
    const response = makeResponse();
    const originalSend = response.send;
    middleware(request, response, jest.fn());
    response.send({ statusCode: 201 });
    await Promise.resolve();
    await Promise.resolve();
    expect(platform.unifyResponse).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(originalSend).toHaveBeenCalledWith({ ok: true });
  });

  it('forwards a unifyResponse failure to next', async () => {
    const failure = new Error('unify failed');
    const platform = { unifyResponse: jest.fn().mockRejectedValue(failure) };
    const middleware = createResponseMiddleware({ platform });
    const request = {};
    const response = makeResponse();
    const next = jest.fn();
    middleware(request, response, next);
    response.send({ hello: 'world' });
    await Promise.resolve();
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(failure);
  });

  it('logs on finish without breaking the request when logging throws', () => {
    const platform = {
      LoggerBuilder: {
        getLogger: () => {
          throw new Error('logger down');
        }
      }
    };
    const middleware = createResponseMiddleware({ platform });
    const request = {};
    const response = makeResponse();
    const next = jest.fn();
    middleware(request, response, next);
    const finishHandler = response.on.mock.calls.find(([event]) => event === 'finish')[1];
    expect(() => finishHandler()).not.toThrow();
  });
});

describe('createErrorHandler', () => {
  it('does nothing when headers were already sent', () => {
    const handler = createErrorHandler({ platform: {} });
    const response = makeResponse({ headersSent: true });
    handler(new Error('late'), {}, response, jest.fn());
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('renders a malformed-JSON SyntaxError as BAD_REQUEST', () => {
    const handler = createErrorHandler({ platform: {} });
    const request = { correlationId: 'trace-3', headers: {} };
    const response = makeResponse();
    const error = new SyntaxError('Unexpected token');
    error.body = '{"a":}';
    handler(error, request, response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(400);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.traceId).toBe('trace-3');
    expect(response.locals.skipResponseEnvelope).toBe(true);
  });

  it('renders a Boom error and does not throw when logging fails', () => {
    const platform = {
      LoggerBuilder: {
        getLogger: () => {
          throw new Error('logger down');
        }
      }
    };
    const handler = createErrorHandler({ platform });
    const request = { headers: { 'x-correlation-id': 'trace-4' } };
    const response = makeResponse();
    expect(() => handler(Boom.notFound('Nope'), request, response, jest.fn())).not.toThrow();
    expect(response.status).toHaveBeenCalledWith(404);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe('NOT_FOUND');
    expect(body.traceId).toBe('trace-4');
  });
});
