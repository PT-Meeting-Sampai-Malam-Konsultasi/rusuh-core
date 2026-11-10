const Boom = require('@hapi/boom');
const { createDuplicateKeyVerifier, detectDuplicateJsonKey } = require('../duplicate-json-keys');
const fallbackPlatform = require('../fallback-platform');
const { createErrorHandler } = require('../error-handler');
const { createResponseMiddleware } = require('../response');

describe('detectDuplicateJsonKey', () => {
  it('returns null for a clean object', () => {
    expect(detectDuplicateJsonKey('{"a": 1, "b": 2}')).toBeNull();
    expect(detectDuplicateJsonKey(Buffer.from('{"a": 1, "b": 2}'))).toBeNull();
  });

  it('returns the duplicate key in the same object', () => {
    expect(detectDuplicateJsonKey('{"a": 1, "a": 2}')).toBe('a');
  });

  it('ignores the same key in different scopes', () => {
    expect(detectDuplicateJsonKey('{"a": {"a": 1}}')).toBeNull();
    expect(detectDuplicateJsonKey('[{"a": 1}, {"a": 2}]')).toBeNull();
    expect(detectDuplicateJsonKey('{"a": 1, "b": {"a": 2}}')).toBeNull();
  });

  it('finds a duplicate in a nested object', () => {
    expect(detectDuplicateJsonKey('{"outer": {"x": 1, "x": 2}}')).toBe('x');
  });

  it('handles whitespace between a key and its colon', () => {
    expect(detectDuplicateJsonKey('{"a" : 1, "a" : 2}')).toBe('a');
  });

  it('handles escaped quotes inside a string value', () => {
    expect(detectDuplicateJsonKey('{"a": "x\\"y", "a": 2}')).toBe('a');
    expect(detectDuplicateJsonKey('{"a": "x\\"y"}')).toBeNull();
  });

  it('returns null for an unterminated string', () => {
    expect(detectDuplicateJsonKey('{"a": "unterminated')).toBeNull();
  });

  it('ignores strings that are values, not keys', () => {
    expect(detectDuplicateJsonKey('{"a": "b", "c": "a"}')).toBeNull();
  });
});

describe('createDuplicateKeyVerifier', () => {
  it('does nothing when disabled', () => {
    const verify = createDuplicateKeyVerifier(false);
    expect(() => verify({}, {}, Buffer.from('{"a": 1, "a": 2}'))).not.toThrow();
  });

  it('does nothing for an empty body', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from(''))).not.toThrow();
  });

  it('throws a Boom bad request on a duplicate key', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from('{"a": 1, "a": 2}'))).toThrow('Duplicate JSON key detected: "a"');
  });

  it('passes a clean body', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from('{"a": 1, "b": 2}'))).not.toThrow();
  });
});

describe('fallbackPlatform', () => {
  it('LoggerBuilder returns a chainable logger that writes to the console', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const logger = fallbackPlatform.LoggerBuilder.getLogger();
      expect(logger.addTags(['x'])).toBe(logger);
      expect(logger.addData({ a: 1 })).toBe(logger);
      logger.info('hello', { a: 1 });
      logger.error('boom', { a: 1 });
      expect(infoSpy).toHaveBeenCalledWith('hello', { a: 1 });
      expect(errorSpy).toHaveBeenCalledWith('boom', { a: 1 });
      expect(fallbackPlatform.LoggerBuilder.getMetadataFromRequest({})).toEqual({});
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('logRequest returns no metadata and unifyResponse returns undefined', () => {
    expect(fallbackPlatform.logRequest({})).toEqual({});
    expect(fallbackPlatform.unifyResponse({}, {}, {})).toBeUndefined();
  });
});

function mockResponse() {
  const response = {
    locals: {},
    headersSent: false,
    statusCode: 200,
    status: jest.fn((code) => {
      response.statusCode = code;
      return response;
    }),
    json: jest.fn(() => response),
    send: jest.fn(() => response),
    type: jest.fn(() => response),
    on: jest.fn()
  };
  return response;
}

describe('createErrorHandler', () => {
  it('renders a Boom error with its status and payload', () => {
    const handler = createErrorHandler();
    const response = mockResponse();
    const error = Boom.badRequest('bad input');
    handler(error, {}, response, () => {});
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('renders a malformed JSON SyntaxError as 400', () => {
    const handler = createErrorHandler();
    const response = mockResponse();
    const error = new SyntaxError('Unexpected token');
    error.body = '{"a":}';
    handler(error, {}, response, () => {});
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Malformed JSON request body' }));
  });

  it('renders a generic error as 500 with a safe message', () => {
    const handler = createErrorHandler();
    const response = mockResponse();
    handler(new Error('something broke'), {}, response, () => {});
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'An unexpected error occurred' })
    );
  });

  it('does nothing when the headers are already sent', () => {
    const handler = createErrorHandler();
    const response = mockResponse();
    response.headersSent = true;
    handler(new Error('late'), {}, response, () => {});
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('still responds when the platform logger throws', () => {
    const platform = {
      LoggerBuilder: {
        getLogger: () => {
          throw new Error('logger down');
        }
      }
    };
    const handler = createErrorHandler({ platform });
    const response = mockResponse();
    handler(new Error('boom'), {}, response, () => {});
    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('logs through an injected platform', () => {
    const logger = { addTags: jest.fn(() => logger), addData: jest.fn(() => logger), error: jest.fn() };
    const platform = { LoggerBuilder: { getLogger: () => logger, getMetadataFromRequest: () => ({ req: '1' }) } };
    const handler = createErrorHandler({ platform });
    const response = mockResponse();
    handler(new Error('boom'), {}, response, () => {});
    expect(logger.addTags).toHaveBeenCalledWith(['error-handler']);
    expect(logger.error).toHaveBeenCalledWith('API request failed');
  });
});

describe('createResponseMiddleware', () => {
  it('calls next and passes a Buffer payload straight through', () => {
    const middleware = createResponseMiddleware();
    const request = {};
    const response = mockResponse();
    const originalSend = response.send;
    const next = jest.fn();
    middleware(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    const payload = Buffer.from('raw');
    response.send(payload);
    expect(originalSend).toHaveBeenCalledWith(payload);
  });

  it('passes through when the envelope is skipped', async () => {
    const middleware = createResponseMiddleware();
    const request = {};
    const response = mockResponse();
    response.locals.skipResponseEnvelope = true;
    const next = jest.fn();
    middleware(request, response, next);
    response.send({ data: 1 });
    expect(response.status).not.toHaveBeenCalled();
  });

  it('wraps a plain payload through the platform unifyResponse', async () => {
    const platform = {
      LoggerBuilder: { getLogger: () => ({ addTags: () => ({ addData: () => ({ info: () => {} }) }) }) },
      getMetadataFromRequest: () => ({}),
      logRequest: () => ({}),
      unifyResponse: jest.fn(async () => ({ statusCode: 201, bodyResponse: { created: true } }))
    };
    const middleware = createResponseMiddleware({ platform });
    const request = {};
    const response = mockResponse();
    const next = jest.fn();
    middleware(request, response, next);
    response.send({ message: 'created' });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(platform.unifyResponse).toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('logs on finish and survives a logging failure', async () => {
    const platform = {
      LoggerBuilder: {
        getLogger: () => {
          throw new Error('logger down');
        }
      }
    };
    const middleware = createResponseMiddleware({ platform });
    const request = {};
    const response = mockResponse();
    const next = jest.fn();
    middleware(request, response, next);
    const finish = response.on.mock.calls.find((call) => call[0] === 'finish')[1];
    expect(() => finish()).not.toThrow();
    // A second finish must not log again.
    expect(() => finish()).not.toThrow();
  });
});
