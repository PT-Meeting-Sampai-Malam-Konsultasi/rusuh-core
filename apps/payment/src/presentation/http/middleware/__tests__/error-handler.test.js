const Boom = require('@hapi/boom');
const { createErrorHandler } = require('../error-handler');

function mockResponse() {
  const response = {
    headersSent: false,
    locals: {},
    statusCode: 200,
    body: undefined,
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
  it('renders a Boom error as its Problem payload', () => {
    const handler = createErrorHandler({});
    const response = mockResponse();
    handler(Boom.notFound('missing'), {}, response, () => {});
    expect(response.statusCode).toBe(404);
    expect(response.body.statusCode).toBe(404);
    expect(response.body.error).toBe('Not Found');
    expect(response.locals.skipResponseEnvelope).toBe(true);
  });

  it('turns a malformed-JSON SyntaxError into a 400', () => {
    const handler = createErrorHandler({});
    const response = mockResponse();
    const error = new SyntaxError('Unexpected token in JSON');
    error.body = '{"a":}';
    handler(error, {}, response, () => {});
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe('Malformed JSON request body');
  });

  it('turns a plain (non-Boom, non-JSON) error into a safe 500 without leaking details', () => {
    const handler = createErrorHandler({});
    const response = mockResponse();
    handler(new Error('db password is hunter2'), {}, response, () => {});
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred'
    });
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('does nothing when the headers were already sent', () => {
    const handler = createErrorHandler({});
    const response = mockResponse();
    response.headersSent = true;
    handler(Boom.badRequest('x'), {}, response, () => {});
    expect(response.statusCode).toBe(200);
    expect(response.body).toBeUndefined();
  });

  it('still sends a safe response when the platform logger throws', () => {
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
    expect(response.statusCode).toBe(500);
    expect(response.body.error).toBe('Internal Server Error');
  });

  it('logs through the injected platform logger when present', () => {
    const error = jest.fn();
    const logger = { addTags: jest.fn(() => logger), addData: jest.fn(() => logger), error };
    const platform = {
      LoggerBuilder: { getLogger: () => logger, getMetadataFromRequest: () => ({ requestId: 'r-1' }) }
    };
    const handler = createErrorHandler({ platform });
    const response = mockResponse();
    handler(Boom.badRequest('bad input'), {}, response, () => {});
    expect(logger.addTags).toHaveBeenCalledWith(['error-handler']);
    expect(logger.addData).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r-1', statusCode: 400 }));
    expect(error).toHaveBeenCalledWith('API request failed');
  });
});
