const express = require('express');
const request = require('supertest');
const { createLogger, createRequestContextMiddleware } = require('@rusuh/observability');
const { createErrorHandler } = require('../error-handler');

function createObservedApp() {
  const lines = [];
  const logger = createLogger({ service: 'core', format: 'json', write: (line) => lines.push(JSON.parse(line)) });
  const app = express();
  app.use(createRequestContextMiddleware({ logger, skipPaths: ['/health/live'] }));
  app.get('/ok', (_request, response) => response.status(200).json({ ok: true }));
  app.get('/forbidden', (_request, response) => response.status(403).json({ code: 'FORBIDDEN' }));
  app.get('/broken', () => {
    throw new Error('unexpected failure');
  });
  app.get('/health/live', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.use(createErrorHandler({ platform: {} }));
  return { app, lines };
}

describe('Core HTTP observability', () => {
  test('preserves a valid request ID across response, problem, and terminal log', async () => {
    const { app, lines } = createObservedApp();
    const id = 'c3f21ea6-f0e7-44d4-a346-3a42fac5fa94';
    const response = await request(app).get('/broken').set('X-Request-ID', id);
    expect(response.status).toBe(500);
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.body.traceId).toBe(id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'http.request.failed', requestId: id, outcome: 'error' });
  });

  test('uses a valid correlation ID only when request ID is absent', async () => {
    const { app, lines } = createObservedApp();
    const id = 'c3f21ea6-f0e7-44d4-a346-3a42fac5fa94';
    const response = await request(app).get('/ok').set('X-Correlation-ID', id);
    expect(response.headers['x-request-id']).toBe(id);
    expect(lines[0].requestId).toBe(id);
  });

  test('replaces invalid inbound request IDs without log injection', async () => {
    const { app, lines } = createObservedApp();
    const response = await request(app).get('/ok').set('X-Request-ID', 'bad-id');
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(lines[0].requestId).toBe(response.headers['x-request-id']);
  });

  test('records expected 4xx as client_error completion with warn policy', async () => {
    const { app, lines } = createObservedApp();
    const response = await request(app).get('/forbidden');
    expect(response.status).toBe(403);
    expect(lines).toEqual([
      expect.objectContaining({ event: 'http.request.completed', outcome: 'client_error', level: 'warn' })
    ]);
  });

  test('unknown 500 keeps the generic body and leaks nothing, while the log keeps sanitized diagnostics', async () => {
    const lines = [];
    const logger = createLogger({ service: 'core', format: 'json', write: (line) => lines.push(JSON.parse(line)) });
    const app = express();
    app.use(createRequestContextMiddleware({ logger }));
    app.get('/leak', () => {
      const error = new Error('db down postgres://user:pa55word@db/rusuh Bearer abc.def.ghi');
      error.cause = new Error('nik=3171010101900001 token=xyz');
      throw error;
    });
    app.use(createErrorHandler({ platform: {} }));

    const response = await request(app).get('/leak');
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      detail: 'An unexpected error occurred'
    });
    expect(JSON.stringify(response.body)).not.toMatch(/pa55word|abc\.def|3171010101900001|stack|cause/i);
    expect(lines).toHaveLength(1);
    expect(lines[0].error.stack).toEqual(expect.any(String));
    expect(JSON.stringify(lines[0])).not.toMatch(/pa55word|abc\.def\.ghi|3171010101900001|token=xyz/);
  });

  test.each([
    [401, 'warn'],
    [429, 'warn'],
    [404, 'info']
  ])('logs %i as client_error at %s level', async (status, level) => {
    const lines = [];
    const logger = createLogger({ service: 'core', format: 'json', write: (line) => lines.push(JSON.parse(line)) });
    const app = express();
    app.use(createRequestContextMiddleware({ logger }));
    app.get('/status', (_request, response) => response.status(status).json({}));
    await request(app).get('/status');
    expect(lines).toEqual([
      expect.objectContaining({ event: 'http.request.completed', outcome: 'client_error', level })
    ]);
  });

  test('success logs one completed/success event with duration and status', async () => {
    const { app, lines } = createObservedApp();
    await request(app).get('/ok');
    expect(lines).toEqual([
      expect.objectContaining({
        event: 'http.request.completed',
        outcome: 'success',
        level: 'info',
        'http.response.status_code': 200,
        durationMs: expect.any(Number)
      })
    ]);
  });

  test('a throwing log writer does not change the HTTP response', async () => {
    const logger = createLogger({
      write: () => {
        throw new Error('stdout closed');
      }
    });
    const app = express();
    app.use(createRequestContextMiddleware({ logger }));
    app.get('/ok', (_request, response) => response.status(200).json({ ok: true }));
    const response = await request(app).get('/ok');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
  });

  test('skips health terminal logs', async () => {
    const { app, lines } = createObservedApp();
    await request(app).get('/health/live');
    expect(lines).toHaveLength(0);
  });
});
