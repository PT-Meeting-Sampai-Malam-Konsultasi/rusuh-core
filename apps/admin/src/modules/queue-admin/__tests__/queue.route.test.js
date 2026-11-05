const request = require('supertest');
const { createTestApp } = require('@/test-helpers');

const frontier = {
  event: 'evt_2026_gbk',
  state: 'paused',
  served: 41250,
  sellable: 3120,
  reserved: 1800,
  held: 640,
  ratePerMin: 450,
  rateLow: 380,
  rateHigh: 540,
  rateSource: 'measured',
  streamFrom: 2000,
  opensAt: 1794625200,
  ts: 1794652800,
  reason: 'operator'
};

describe('queue-admin routes', () => {
  const admin = (req) => req.set('Authorization', 'Bearer admin-token');

  it('PATCH /v1/admin/events/:id/queue forwards to the queue admin API', async () => {
    const calls = [];
    const queueClient = {
      updateQueue: async (eventId, body) => {
        calls.push({ eventId, body });
        return frontier;
      }
    };
    const { app } = createTestApp({ queueClient });
    const response = await admin(
      request(app).patch('/v1/admin/events/evt_2026_gbk/queue').send({ state: 'paused', reason: 'operator' })
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual(frontier);
    expect(calls).toEqual([{ eventId: 'evt_2026_gbk', body: { state: 'paused', reason: 'operator' } }]);
  });

  it('PATCH /v1/admin/events/:id/queue returns 503 when the queue API is unconfigured', async () => {
    const { app } = createTestApp();
    const response = await admin(request(app).patch('/v1/admin/events/evt_2026_gbk/queue').send({ state: 'paused' }));
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('PATCH /v1/admin/events/:id/queue rejects an invalid state', async () => {
    const { app } = createTestApp({ queueClient: { updateQueue: async () => frontier } });
    const response = await admin(request(app).patch('/v1/admin/events/evt_2026_gbk/queue').send({ state: 'frozen' }));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH /v1/admin/events/:id/queue returns 404 for an unknown event', async () => {
    const { app } = createTestApp({ queueClient: { updateQueue: async () => frontier } });
    const response = await admin(request(app).patch('/v1/admin/events/evt_nope/queue').send({ state: 'paused' }));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('returns 401 without a token', async () => {
    const { app } = createTestApp();
    const response = await request(app).patch('/v1/admin/events/evt_2026_gbk/queue').send({ state: 'paused' });
    expect(response.status).toBe(401);
  });
});
