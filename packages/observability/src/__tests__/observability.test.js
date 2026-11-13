const {
  createLogger,
  createOutboundHeaders,
  resolveRequestId,
  sanitizeForLog,
  validateRequestId,
  validateTelemetryConfig
} = require('..');

describe('@rusuh/observability contract', () => {
  test('creates immutable child logger contexts', () => {
    const lines = [];
    const logger = createLogger({ service: 'test', write: (line) => lines.push(JSON.parse(line)) });
    logger.child({ requestId: 'first' }).info('event.one');
    logger.info('event.two');
    expect(lines[0]).toMatchObject({ service: 'test', event: 'event.one', requestId: 'first' });
    expect(lines[1]).toMatchObject({ service: 'test', event: 'event.two' });
    expect(lines[1].requestId).toBeUndefined();
  });

  test('redacts recursive sensitive data and error causes', () => {
    const cause = new Error('Bearer token-value at postgres://user:password@db/rusuh?nik=123');
    const error = new Error('payment failed');
    error.cause = cause;
    const result = sanitizeForLog({ authorization: 'Bearer secret', profile: { nik: '123' }, error });
    expect(JSON.stringify(result)).not.toMatch(/token-value|123|password@db/);
    expect(result.authorization).toBe('[REDACTED]');
  });

  test('accepts only canonical RFC 4122 UUID request IDs', () => {
    const id = 'c3f21ea6-f0e7-44d4-a346-3a42fac5fa94';
    expect(validateRequestId(id)).toBe(id);
    expect(validateRequestId(` ${id}`)).toBeNull();
    expect(validateRequestId(`${id}\n`)).toBeNull();
    expect(validateRequestId('correlation-123')).toBeNull();
    expect(validateRequestId('a'.repeat(37))).toBeNull();
    expect(resolveRequestId({ 'x-request-id': 'invalid' }, () => id)).toBe(id);
  });

  test('adds only the canonical request ID to explicit outbound headers', () => {
    expect(createOutboundHeaders({ 'x-service-key': 'service' }, { requestId: 'request-1' })).toEqual({
      'x-service-key': 'service',
      'X-Request-ID': 'request-1'
    });
  });

  test('rejects invalid telemetry configuration before startup', () => {
    expect(() =>
      validateTelemetryConfig({
        tracesExporter: 'otlp',
        sampler: 'parentbased_traceidratio',
        samplerArg: 2,
        endpoint: 'bad'
      })
    ).toThrow('Invalid OTEL_TRACES_SAMPLER_ARG');
  });
});
