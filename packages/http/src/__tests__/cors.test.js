const express = require('express');
const request = require('supertest');
const { DEFAULT_CORS_ORIGINS, parseCorsOrigins, createCors } = require('..');

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
