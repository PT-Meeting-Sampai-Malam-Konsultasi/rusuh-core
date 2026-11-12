const express = require('express');
const request = require('supertest');
const { DEFAULT_CORS_ORIGINS, parseCorsOrigins, createOriginMatcher, createCors } = require('..');

describe('parseCorsOrigins', () => {
  it('returns the defaults when the value is empty or missing', () => {
    expect(parseCorsOrigins(undefined)).toEqual(DEFAULT_CORS_ORIGINS);
    expect(parseCorsOrigins(null)).toEqual(DEFAULT_CORS_ORIGINS);
    expect(parseCorsOrigins('')).toEqual(DEFAULT_CORS_ORIGINS);
    expect(parseCorsOrigins(' , ,')).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('keeps the production and local dev defaults', () => {
    expect(DEFAULT_CORS_ORIGINS).toEqual([
      'https://rusuh-tiket.web.id',
      'https://www.rusuh-tiket.web.id',
      'https://staging.rusuh-tiket.web.id',
      'https://*.rusuh-web-staging.pages.dev',
      'http://localhost:3000',
      'http://localhost:5173'
    ]);
  });

  it('trims entries and drops empty ones', () => {
    expect(parseCorsOrigins('  https://a.example.com , ,https://b.example.com,, ')).toEqual([
      'https://a.example.com',
      'https://b.example.com'
    ]);
  });

  it('returns a copy, not the shared default reference', () => {
    const first = parseCorsOrigins('');
    first.push('https://evil.example.com');
    expect(parseCorsOrigins('')).toEqual(DEFAULT_CORS_ORIGINS);
    expect(first).not.toBe(DEFAULT_CORS_ORIGINS);
  });
});

describe('createCors', () => {
  const app = express();
  app.use(createCors(['http://localhost:3000']));
  app.get('/ping', (req, res) => res.json({ ok: true }));

  it('answers preflight for an allowed origin without credentials', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not echo an origin outside the list', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('wildcard origins', () => {
  const WILDCARD = 'https://*.rusuh-web-staging.pages.dev';
  const app = express();
  app.use(createCors(['https://rusuh-tiket.web.id', WILDCARD, 'http://localhost:3000']));
  app.get('/ping', (req, res) => res.json({ ok: true }));

  const preflight = (origin) =>
    request(app).options('/ping').set('Origin', origin).set('Access-Control-Request-Method', 'GET');

  it.each(['https://pr-42.rusuh-web-staging.pages.dev', 'https://a1-b.rusuh-web-staging.pages.dev'])(
    'allows %s on preflight and real requests',
    async (origin) => {
      const pre = await preflight(origin);
      expect(pre.status).toBe(204);
      expect(pre.headers['access-control-allow-origin']).toBe(origin);
      const real = await request(app).get('/ping').set('Origin', origin);
      expect(real.headers['access-control-allow-origin']).toBe(origin);
    }
  );

  it.each([
    'https://rusuh-web-staging.pages.dev',
    'https://a.b.rusuh-web-staging.pages.dev',
    'https://pr-42.rusuh-web-staging.pages.dev.evil.com',
    'https://evilrusuh-web-staging.pages.dev',
    'http://pr-42.rusuh-web-staging.pages.dev',
    'https://pr-42.rusuh-web-staging.pages.dev:8443',
    'https://.rusuh-web-staging.pages.dev',
    'https://pr_42.rusuh-web-staging.pages.dev',
    'https://evil.com'
  ])('rejects %s', async (origin) => {
    const pre = await preflight(origin);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    const real = await request(app).get('/ping').set('Origin', origin);
    expect(real.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('still allows exact origins and sends no header without an Origin', async () => {
    const pre = await preflight('https://rusuh-tiket.web.id');
    expect(pre.headers['access-control-allow-origin']).toBe('https://rusuh-tiket.web.id');
    const real = await request(app).get('/ping');
    expect(real.status).toBe(200);
    expect(real.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps Vary: Origin', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://pr-42.rusuh-web-staging.pages.dev');
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it('allows the x-request-id request header on preflight', async () => {
    const res = await preflight('https://pr-42.rusuh-web-staging.pages.dev').set(
      'Access-Control-Request-Headers',
      'x-request-id'
    );
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('x-request-id');
  });

  it('compares the port exactly when the entry has one', () => {
    const match = createOriginMatcher(['https://*.example.com:8443']);
    expect(match('https://a.example.com:8443')).toBe(true);
    expect(match('https://a.example.com')).toBe(false);
    expect(match('https://a.example.com:9000')).toBe(false);
  });

  it('treats dots in the host literally', () => {
    const match = createOriginMatcher(['https://*.a.b']);
    expect(match('https://x.a.b')).toBe(true);
    expect(match('https://x.aXb')).toBe(false);
  });

  it.each([
    'https://*',
    '*',
    'https://a.*.example.com',
    'https://*.',
    'https://*.*.example.com',
    'https://*.example.com/path',
    'https://*.exa*mple.com'
  ])('never matches with malformed entry %s', (entry) => {
    const match = createOriginMatcher([entry]);
    [
      entry,
      'https://a.example.com',
      'https://anything.com',
      'https://x.y.example.com',
      'https://a.example.com/path',
      'null',
      ''
    ].forEach((origin) => expect(match(origin)).toBe(false));
  });
});
