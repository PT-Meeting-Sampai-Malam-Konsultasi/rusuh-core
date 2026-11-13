const { context, trace } = require('@opentelemetry/api');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const {
  classifyHttpFailure,
  createLogger,
  instrumentAdapter,
  reportHttpFailure,
  runWithRequestContext
} = require('..');
const { createTelemetry, validateTelemetryConfig } = require('../telemetry');

const REQUEST_ID = 'c3f21ea6-f0e7-44d4-a346-3a42fac5fa94';

function capture() {
  const lines = [];
  const logger = createLogger({ service: 'test', format: 'json', write: (line) => lines.push(JSON.parse(line)) });
  return { lines, logger };
}

describe('classifyHttpFailure', () => {
  test.each([
    [new Error('x'), { timedOut: true }, 'timeout'],
    [Object.assign(new Error('x'), { name: 'AbortError' }), {}, 'canceled'],
    [Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }), {}, 'dns'],
    [Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } }), {}, 'connection'],
    [Object.assign(new Error('x'), { status: 502 }), {}, 'unexpected_response'],
    [new Error('x'), {}, 'unknown']
  ])('classifies %#', (error, options, expected) => {
    expect(classifyHttpFailure(error, options)).toBe(expected);
  });
});

describe('reportHttpFailure', () => {
  test('logs allowlisted fields only and carries the request ID', () => {
    const { lines, logger } = capture();
    const error = Object.assign(new Error('Dukcapil responded 502'), { status: 502 });
    runWithRequestContext({ requestId: REQUEST_ID }, () =>
      reportHttpFailure({ logger, service: 'dukcapil', operation: 'verify', error })
    );
    expect(lines[0]).toMatchObject({
      event: 'dependency.http.failed',
      requestId: REQUEST_ID,
      'upstream.service': 'dukcapil',
      'upstream.operation': 'verify',
      'upstream.failure_category': 'unexpected_response',
      'upstream.status_code': 502
    });
  });

  test('never throws when the logger is missing or broken', () => {
    const error = new Error('x');
    expect(() => reportHttpFailure({ service: 'dukcapil', operation: 'verify', error })).not.toThrow();
    const broken = {
      warn: () => {
        throw new Error('down');
      }
    };
    expect(() => reportHttpFailure({ logger: broken, service: 'dukcapil', operation: 'verify', error })).not.toThrow();
  });
});

describe('instrumentAdapter', () => {
  test('logs postgres failures with operation and SQLSTATE only, then rethrows unchanged', async () => {
    const { lines, logger } = capture();
    const failure = Object.assign(new Error('relation "bookings" does not exist; password=hunter2'), {
      code: '42P01'
    });
    const store = instrumentAdapter(
      { getBooking: async () => Promise.reject(failure), name: 'plain' },
      { logger, kind: 'postgres' }
    );
    await expect(store.getBooking('bk_1')).rejects.toBe(failure);
    expect(store.name).toBe('plain');
    expect(lines[0]).toMatchObject({
      event: 'dependency.postgres.failed',
      'db.operation': 'getBooking',
      'db.sqlstate': '42P01'
    });
    expect(JSON.stringify(lines[0])).not.toMatch(/hunter2|bk_1|bookings/);
  });

  test('logs valkey failures with the operation name and no arguments', async () => {
    const { lines, logger } = capture();
    const stock = instrumentAdapter(
      {
        getAdmission: async () => {
          throw new Error('ECONNRESET for admission:secret-token');
        }
      },
      { logger, kind: 'valkey' }
    );
    await expect(stock.getAdmission('secret-token')).rejects.toThrow('ECONNRESET');
    expect(lines[0]).toMatchObject({ event: 'dependency.valkey.failed', 'cache.operation': 'getAdmission' });
    expect(JSON.stringify(lines[0])).not.toMatch(/secret-token|admission:/);
  });

  test('passes successful and synchronous results through untouched', async () => {
    const { lines, logger } = capture();
    const adapter = instrumentAdapter({ ok: async () => 7, sync: () => 3 }, { logger, kind: 'valkey' });
    await expect(adapter.ok()).resolves.toBe(7);
    expect(adapter.sync()).toBe(3);
    expect(lines).toHaveLength(0);
  });
});

describe('logger failure isolation and OTel fields', () => {
  test('a throwing writer never propagates to the caller', () => {
    const logger = createLogger({
      write: () => {
        throw new Error('stdout closed');
      }
    });
    expect(() => logger.error('http.request.failed', { a: 1 })).not.toThrow();
  });

  test('adds otel.trace_id and otel.span_id only inside a valid active span', () => {
    const { lines, logger } = capture();
    logger.info('outside');
    const spanContext = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 };
    const span = trace.wrapSpanContext(spanContext);
    const contextManager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(contextManager);
    try {
      context.with(trace.setSpan(context.active(), span), () => logger.info('inside'));
    } finally {
      context.disable();
      contextManager.disable();
    }
    expect(lines[0]['otel.trace_id']).toBeUndefined();
    expect(lines[1]).toMatchObject({ 'otel.trace_id': 'a'.repeat(32), 'otel.span_id': 'b'.repeat(16) });
    expect(lines[1].traceId).toBeUndefined();
  });
});

describe('telemetry lifecycle', () => {
  const base = {
    tracesExporter: 'none',
    sampler: 'parentbased_always_on',
    samplerArg: 1,
    endpoint: 'http://localhost:4318'
  };

  test('none exporter is a deterministic no-op whose shutdown resolves', async () => {
    const telemetry = createTelemetry({ ...base, serviceName: 'core', environment: 'test' });
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  test.each([
    [{ tracesExporter: 'stdout' }, 'Invalid OTEL_TRACES_EXPORTER'],
    [{ sampler: 'always_off' }, 'Invalid OTEL_TRACES_SAMPLER'],
    [{ samplerArg: -1 }, 'Invalid OTEL_TRACES_SAMPLER_ARG'],
    [{ tracesExporter: 'otlp', endpoint: 'not a url' }, 'Invalid OTEL_ENDPOINT'],
    [{ tracesExporter: 'otlp', endpoint: 'ftp://collector' }, 'Invalid OTEL_ENDPOINT']
  ])('rejects invalid config %#', (override, message) => {
    expect(() => validateTelemetryConfig({ ...base, ...override })).toThrow(message);
  });

  test('otlp with an unreachable collector starts and shuts down without throwing', async () => {
    const telemetry = createTelemetry({
      ...base,
      tracesExporter: 'otlp',
      endpoint: 'http://127.0.0.1:1',
      serviceName: 'core',
      environment: 'test'
    });
    let timer;
    const bound = new Promise((resolve) => {
      timer = setTimeout(resolve, 3000);
    });
    await expect(Promise.race([telemetry.shutdown(), bound])).resolves.not.toThrow();
    clearTimeout(timer);
  });
});
