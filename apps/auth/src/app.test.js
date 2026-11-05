const request = require('supertest');
const { loadEnvironment } = require('./config/environment');
const { createApp } = require('./app');

describe('auth service', () => {
  const app = createApp({ config: loadEnvironment({}) });

  it('GET /sys/ping returns ok', async () => {
    const response = await request(app).get('/sys/ping');
    expect(response.status).toBe(200);
    expect(response.text).toBe('ok');
  });

  it('GET /health/live returns ok', async () => {
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns ready', async () => {
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
  });

  it('unknown route returns 404', async () => {
    const response = await request(app).get('/nope');
    expect(response.status).toBe(404);
  });
});
