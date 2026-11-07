const Boom = require('@hapi/boom');
const { ApiError } = require('@/domain/errors');
const { createProblemHandler } = require('../problem-handler');

function makePlatform() {
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
    }
  };
}

function makeResponse() {
  const response = { locals: {}, headersSent: false, statusCode: 200 };
  response.status = jest.fn(() => response);
  response.json = jest.fn(() => response);
  return response;
}

describe('createProblemHandler', () => {
  it('throws when no platform is provided', () => {
    expect(() => createProblemHandler()).toThrow('createProblemHandler requires platform');
    expect(() => createProblemHandler({})).toThrow('createProblemHandler requires platform');
  });

  it('renders an ApiError with its code, detail and extra members', () => {
    const platform = makePlatform();
    const handle = createProblemHandler({ platform });
    const response = makeResponse();
    handle(new ApiError('NOT_FOUND', 'no such event', { eventId: 'evt_1' }), {}, response, () => {});
    expect(response.status).toHaveBeenCalledWith(404);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe('NOT_FOUND');
    expect(body.detail).toBe('no such event');
    expect(body.eventId).toBe('evt_1');
    expect(response.locals.skipResponseEnvelope).toBe(true);
  });

  it('adds traceId from the request correlationId', () => {
    const platform = makePlatform();
    const handle = createProblemHandler({ platform });
    const response = makeResponse();
    handle(new Error('boom'), { correlationId: 'req-123' }, response, () => {});
    expect(response.json.mock.calls[0][0].traceId).toBe('req-123');
  });

  it('maps a Boom error to the repo code for its status', () => {
    const cases = [
      [400, 'VALIDATION_FAILED'],
      [401, 'UNAUTHORIZED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [503, 'SERVICE_UNAVAILABLE'],
      [418, 'INTERNAL_ERROR']
    ];
    cases.forEach(([status, code]) => {
      const platform = makePlatform();
      const handle = createProblemHandler({ platform });
      const response = makeResponse();
      handle(Boom.boomify(new Error('x'), { statusCode: status }), {}, response, () => {});
      expect(response.json.mock.calls[0][0].code).toBe(code);
    });
  });

  it('renders a Joi error as VALIDATION_FAILED with joined details', () => {
    const platform = makePlatform();
    const handle = createProblemHandler({ platform });
    const response = makeResponse();
    const joiError = new Error('bad input');
    joiError.isJoi = true;
    joiError.details = [{ message: '"name" is required' }, { message: '"cap" must be a number' }];
    handle(joiError, {}, response, () => {});
    expect(response.status).toHaveBeenCalledWith(400);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.detail).toBe('"name" is required, "cap" must be a number');
  });

  it('renders a malformed-JSON SyntaxError as VALIDATION_FAILED', () => {
    const platform = makePlatform();
    const handle = createProblemHandler({ platform });
    const response = makeResponse();
    const syntaxError = new SyntaxError('Unexpected token');
    syntaxError.body = '{bad json';
    handle(syntaxError, {}, response, () => {});
    expect(response.status).toHaveBeenCalledWith(400);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.detail).toBe('Malformed JSON request body');
  });

  it('renders a generic error as INTERNAL_ERROR (500) without leaking internals', () => {
    const platform = makePlatform();
    const handle = createProblemHandler({ platform });
    const response = makeResponse();
    handle(new Error('secret stack trace'), {}, response, () => {});
    expect(response.status).toHaveBeenCalledWith(500);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toMatch('secret stack trace');
  });

  it('does nothing when the headers are already sent', () => {
    const platform = makePlatform();
    const handle = createProblemHandler({ platform });
    const response = makeResponse();
    response.headersSent = true;
    handle(new Error('late error'), {}, response, () => {});
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('still responds when logging fails', () => {
    const platform = makePlatform();
    platform.LoggerBuilder.getLogger = jest.fn(() => {
      throw new Error('logger down');
    });
    const handle = createProblemHandler({ platform });
    const response = makeResponse();
    expect(() => handle(new Error('x'), {}, response, () => {})).not.toThrow();
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalled();
  });
});
