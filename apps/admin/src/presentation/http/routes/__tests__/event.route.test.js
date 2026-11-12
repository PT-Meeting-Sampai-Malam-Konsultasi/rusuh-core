const request = require('supertest');
const { createTestApp } = require('@/test-helpers');
const { loadEnvironment } = require('@/infrastructure/config/environment');

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
          subtitle: 'Malam Pertama',
          format: 'Live',
          venue: 'Istora',
          venue_short: 'Istora',
          city: 'Jakarta',
          starts_at: '2026-12-01T12:00:00Z',
          doors_open_at: '2026-12-01T10:00:00Z',
          capacity: 500,
          event_code: 'KBR',
          image_url: 'https://cdn.rusuh.id/events/evt_baru/hero.svg',
          categories: [
            { name: 'General', price: 200000, total: 500, gate: 'Gerbang 2', category_code: 'GEN', seating: 'standing' }
          ]
        })
    );
    expect(response.status).toBe(201);
    expect(response.body.state).toBe('draft');
    expect(response.body.event_id).toMatch(/^evt_/);
    expect(response.body.event_code).toBe('KBR');
    expect(response.body.categories).toHaveLength(1);
    expect(response.body.categories[0].category_code).toBe('GEN');
  });

  it('POST /v1/admin/events rejects a body missing core-required fields', async () => {
    const response = await admin(
      request(app)
        .post('/v1/admin/events')
        .send({ name: 'X', venue: 'Y', categories: [{ name: 'G', price: 1, total: 1 }] })
    );
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('PUT /v1/admin/events/:id publishes a draft to coming_soon', async () => {
    const response = await admin(request(app).put('/v1/admin/events/evt_2026_draft').send({ state: 'coming_soon' }));
    expect(response.status).toBe(200);
    expect(response.body.state).toBe('coming_soon');
  });

  it('PUT /v1/admin/events rejects price changes after on_sale', async () => {
    const response = await admin(
      request(app)
        .put('/v1/admin/events/evt_2026_gbk')
        .send({
          categories: [{ name: 'Festival', price: 999999, total: 2000, gate: 'Gerbang 5', category_code: 'FES' }]
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

describe('admin event image upload, asset URL and stock seeding', () => {
  const admin = (req) => req.set('Authorization', 'Bearer admin-token');
  const config = { ...loadEnvironment({}), assetBaseUrl: 'https://cdn.rusuh.id' };
  const body = (extra = {}) => ({
    name: 'Konser',
    venue: 'Istora',
    starts_at: '2026-12-01T12:00:00Z',
    capacity: 10,
    event_code: 'KNS',
    categories: [{ name: 'G', price: 1000, total: 10, category_code: 'GEN' }],
    ...extra
  });

  it('seeds stock for every created category', async () => {
    const stockSeeder = { seedCategories: jest.fn().mockResolvedValue() };
    const { app } = createTestApp({ stockSeeder, config });
    const response = await admin(request(app).post('/v1/admin/events').send(body()));
    expect(response.status).toBe(201);
    expect(stockSeeder.seedCategories).toHaveBeenCalledWith(
      response.body.event_id,
      expect.arrayContaining([expect.objectContaining({ total: 10 })])
    );
  });

  it('rejects an image_url outside the asset origin (e.g. a private bucket URL)', async () => {
    const { app } = createTestApp({ config });
    const bad = body({ image_url: 'https://msmk-prod-etiket-1.s3.ap-southeast-3.amazonaws.com/events/p.avif' });
    const response = await admin(request(app).post('/v1/admin/events').send(bad));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    const ok = await admin(
      request(app)
        .post('/v1/admin/events')
        .send(body({ image_url: 'https://cdn.rusuh.id/events/x/hero.webp' }))
    );
    expect(ok.status).toBe(201);
  });

  it('issues an upload for an existing event, admin only', async () => {
    const imageUploads = {
      createUpload: jest
        .fn()
        .mockResolvedValue({ upload_url: 'u', fields: {}, image_url: 'https://cdn.rusuh.id/a.png' })
    };
    const { app } = createTestApp({ imageUploads, config });
    const response = await admin(
      request(app).post('/v1/admin/events/evt_2026_gbk/image-upload').send({ content_type: 'image/png' })
    );
    expect(response.status).toBe(201);
    expect(imageUploads.createUpload).toHaveBeenCalledWith({ eventId: 'evt_2026_gbk', contentType: 'image/png' });
    const missing = await admin(
      request(app).post('/v1/admin/events/evt_nope/image-upload').send({ content_type: 'image/png' })
    );
    expect(missing.status).toBe(404);
    const customer = await request(app)
      .post('/v1/admin/events/evt_2026_gbk/image-upload')
      .set('Authorization', 'Bearer customer-token')
      .send({ content_type: 'image/png' });
    expect(customer.status).toBe(403);
  });
});
