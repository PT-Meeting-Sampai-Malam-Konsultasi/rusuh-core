const Boom = require('@hapi/boom');
const { problemError } = require('@/domain/problem');
const defaultPlatform = require('@/platform/common');
const { createErrorHandler } = require('../error-handler');

function makeResponse() {
  const response = {
    headersSent: false,
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

describe('createErrorHandler (Problem JSON, RFC 9457)', () => {
  it('requires the platform to be injected', () => {
    expect(() => createErrorHandler()).toThrow('createErrorHandler requires platform');
    expect(() => createErrorHandler({})).toThrow('createErrorHandler requires platform');
  });

  it('renders a problemError as-is, with the canonical request ID as traceId', () => {
    const handler = createErrorHandler({ platform: defaultPlatform });
    const response = makeResponse();
    const request = { requestId: 'c3f21ea6-f0e7-44d4-a346-3a42fac5fa94', headers: {} };
    handler(problemError('NOT_FOUND', 'No such resource for this caller.'), request, response, () => {});
    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND', status: 404, traceId: request.requestId });
    expect(response.locals.skipResponseEnvelope).toBe(true);
  });

  it('omits traceId when request context has not established an ID', () => {
    const handler = createErrorHandler({ platform: defaultPlatform });
    const response = makeResponse();
    handler(problemError('NOT_FOUND'), { headers: {} }, response, () => {});
    expect(response.body.traceId).toBeUndefined();
  });

  it('maps a Boom 400 to VALIDATION_FAILED and a Boom 404 to NOT_FOUND', () => {
    const handler = createErrorHandler({ platform: defaultPlatform });
    const bad = makeResponse();
    handler(Boom.badRequest('bad input'), { headers: {} }, bad, () => {});
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });

    const missing = makeResponse();
    handler(Boom.notFound('gone'), { headers: {} }, missing, () => {});
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('maps any other Boom status to INTERNAL_ERROR with the Boom status', () => {
    const handler = createErrorHandler({ platform: defaultPlatform });
    const response = makeResponse();
    handler(Boom.badImplementation('boom'), { headers: {} }, response, () => {});
    expect(response.statusCode).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('maps a SyntaxError with a body (malformed JSON) to VALIDATION_FAILED', () => {
    const handler = createErrorHandler({ platform: defaultPlatform });
    const response = makeResponse();
    const error = new SyntaxError('Unexpected token');
    error.body = '{"a":}';
    handler(error, { headers: {} }, response, () => {});
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('maps a plain unexpected error to INTERNAL_ERROR (500)', () => {
    const handler = createErrorHandler({ platform: defaultPlatform });
    const response = makeResponse();
    handler(new Error('something broke'), { headers: {} }, response, () => {});
    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
  });

  it('does nothing when the headers were already sent', () => {
    const handler = createErrorHandler({ platform: defaultPlatform });
    const response = makeResponse();
    response.headersSent = true;
    handler(new Error('late'), { headers: {} }, response, () => {});
    expect(response.statusCode).toBeNull();
    expect(response.body).toBeNull();
  });

  it('still responds when the platform logger throws', () => {
    const brokenPlatform = {
      LoggerBuilder: {
        getLogger: () => {
          throw new Error('logger down');
        },
        getMetadataFromRequest: () => ({})
      }
    };
    const handler = createErrorHandler({ platform: brokenPlatform });
    const response = makeResponse();
    handler(problemError('NOT_FOUND'), { headers: {} }, response, () => {});
    expect(response.statusCode).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
