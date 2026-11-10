const Boom = require('@hapi/boom');
const { apiError } = require('@/domain/errors');
const { createErrorHandler } = require('../error-handler');

function makePlatform({ throwOnLogger = false } = {}) {
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
    }
  };
}

function makeResponse({ headersSent = false } = {}) {
  const response = {
    headersSent,
    locals: {},
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  return response;
}

describe('createErrorHandler', () => {
  it('requires platform', () => {
    expect(() => createErrorHandler({})).toThrow('createErrorHandler requires platform');
    expect(() => createErrorHandler()).toThrow('createErrorHandler requires platform');
  });

  it('renders a known machine code as Problem JSON', () => {
    const platform = makePlatform();
    const handler = createErrorHandler({ platform });
    const response = makeResponse();
    handler(apiError('TICKET_NOT_FOUND', 'Ticket tk_1 was not found'), {}, response, () => {});
    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ code: 'TICKET_NOT_FOUND', status: 404 });
    expect(response.locals.skipResponseEnvelope).toBe(true);
  });

  it('renders a Boom error with a known code as Problem JSON', () => {
    const platform = makePlatform();
    const handler = createErrorHandler({ platform });
    const response = makeResponse();
    const boomError = Boom.notFound('Ticket tk_1 was not found');
    boomError.data = { code: 'TICKET_NOT_FOUND' };
    handler(boomError, {}, response, () => {});
    expect(response.statusCode).toBe(404);
    expect(response.body.code).toBe('TICKET_NOT_FOUND');
  });

  it('renders a Boom error without a code as its Boom payload', () => {
    const platform = makePlatform();
    const handler = createErrorHandler({ platform });
    const response = makeResponse();
    handler(Boom.badRequest('plain bad request'), {}, response, () => {});
    expect(response.statusCode).toBe(400);
    expect(response.body.statusCode).toBe(400);
  });

  it('renders malformed JSON (SyntaxError with a body) as a 400', () => {
    const platform = makePlatform();
    const handler = createErrorHandler({ platform });
    const response = makeResponse();
    const error = new SyntaxError('Unexpected token in JSON');
    error.body = '{"a":}';
    handler(error, {}, response, () => {});
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain('Malformed JSON');
  });

  it('renders an unknown error as a generic 500', () => {
    const platform = makePlatform();
    const handler = createErrorHandler({ platform });
    const response = makeResponse();
    handler(new Error('boom'), {}, response, () => {});
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred'
    });
  });

  it('does nothing when the headers were already sent', () => {
    const platform = makePlatform();
    const handler = createErrorHandler({ platform });
    const response = makeResponse({ headersSent: true });
    handler(new Error('boom'), {}, response, () => {});
    expect(response.statusCode).toBeNull();
    expect(response.body).toBeNull();
    expect(platform.logger.error).not.toHaveBeenCalled();
  });

  it('still responds when logging throws', () => {
    const platform = makePlatform({ throwOnLogger: true });
    const handler = createErrorHandler({ platform });
    const response = makeResponse();
    handler(apiError('FORBIDDEN', 'nope'), {}, response, () => {});
    expect(response.statusCode).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
