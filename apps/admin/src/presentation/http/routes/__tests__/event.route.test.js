const request = require('supertest');
const { createTestApp } = require('@/test-helpers');

describe('admin events routes', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  const admin = (req) => req.set('Authorization', 'Bearer admin-token');

  it('GET /v1/admin/events lists events (admin only)', async () => {
    const response = await admin(request(app).get('/v1/admin/events'));
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
  });

  it('GET /v1/admin/events/:id returns the event with cap fields', async () => {
    const response = await admin(request(app).get('/v1/admin/events/evt_2026_gbk'));
    expect(response.status).toBe(200);
    expect(response.body.cap).toBe(2000);
    expect(response.body.infra_cap).toBe(1500);
    expect(response.body.categories).toHaveLength(2);
  });

  it('GET /v1/admin/events/:id/cap returns cap + slot stats', async () => {
    const response = await admin(request(app).get('/v1/admin/events/evt_2026_gbk/cap'));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      cap_tier: 3,
      cap: 2000,
      effective_cap: 1500,
      infra_cap: 1500,
      slots: { total: 2200, held: 3, sold: 1, available: 2196 }
    });
  });

  it('PUT /v1/admin/events/:id/cap accepts cap=0 (pause)', async () => {
    const response = await admin(request(app).put('/v1/admin/events/evt_2026_gbk/cap').send({ cap: 0 }));
    expect(response.status).toBe(200);
    expect(response.body.cap).toBe(0);
    expect(response.body.effective_cap).toBe(0);
  });

  it('PUT /v1/admin/events/:id/cap rejects a negative cap with 400', async () => {
    const response = await admin(request(app).put('/v1/admin/events/evt_2026_gbk/cap').send({ cap: -5 }));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('PUT /v1/admin/events/:id/cap computes the cap from a tier', async () => {
    const response = await admin(request(app).put('/v1/admin/events/evt_2026_gbk/cap').send({ cap_tier: 10 }));
    expect(response.status).toBe(200);
    expect(response.body.cap).toBe(22000);
    expect(response.body.effective_cap).toBe(1500);
  });

  it('GET /v1/admin/events/:id/stats returns cap + slots', async () => {
    const response = await admin(request(app).get('/v1/admin/events/evt_2026_gbk/stats'));
    expect(response.status).toBe(200);
    expect(response.body.event_id).toBe('evt_2026_gbk');
    expect(response.body.slots.available).toBe(2196);
  });

  it('POST /v1/admin/events creates a draft event', async () => {
    const response = await admin(
      request(app)
        .post('/v1/admin/events')
        .send({
          name: 'Konser Baru',
          venue: 'Istora',
          date: '2026-12-01',
          doors_open_at: '2026-12-01T17:00:00+07:00',
          categories: [{ name: 'General', price: 200000, total: 500, gate: 'Gerbang 2' }]
        })
    );
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('draft');
    expect(response.body.categories).toHaveLength(1);
  });

  it('PUT /v1/admin/events rejects price changes after on_sale', async () => {
    const response = await admin(
      request(app)
        .put('/v1/admin/events/evt_2026_gbk')
        .send({
          categories: [{ name: 'Festival', price: 999999, total: 2000, gate: 'Gerbang 5' }]
        })
    );
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 for an unknown event', async () => {
    const response = await admin(request(app).get('/v1/admin/events/evt_nope'));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/v1/admin/events');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 for a customer token (wrong role)', async () => {
    const response = await request(app).get('/v1/admin/events').set('Authorization', 'Bearer customer-token');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('returns 401 for an unknown token', async () => {
    const response = await request(app).get('/v1/admin/events').set('Authorization', 'Bearer bogus');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });
});
