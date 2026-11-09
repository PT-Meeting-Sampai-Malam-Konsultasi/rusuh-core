const request = require('supertest');
const { createTestApp } = require('@/test-app');

describe('events', () => {
  it('lists events (public) with priceFrom', async () => {
    const { app } = await createTestApp();
    const response = await request(app).get('/v1/core/events');
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      eventId: 'evt_2026_gbk',
      name: 'Samudra',
      priceFrom: { amount: 750000, currency: 'IDR' },
      state: 'on_sale'
    });
  });

  it('returns one event (public)', async () => {
    const { app } = await createTestApp();
    const response = await request(app).get('/v1/core/events/evt_2026_gbk');
    expect(response.status).toBe(200);
    expect(response.body.eventId).toBe('evt_2026_gbk');
    expect(response.body.priceFrom).toEqual({ amount: 750000, currency: 'IDR' });
  });

  it('returns 404 for an unknown event', async () => {
    const { app } = await createTestApp();
    const response = await request(app).get('/v1/core/events/evt_missing');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('lists categories with live availability (admission-gated)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const response = await request(app)
      .get('/v1/core/events/evt_2026_gbk/categories')
      .set('Authorization', `Bearer ${accountToken}`)
      .set('X-Admission-Token', admissionToken);
    expect(response.status).toBe(200);
    expect(response.body.categories).toHaveLength(3);
    const vip = response.body.categories.find((category) => category.categoryId === 'cat_vip');
    expect(vip).toMatchObject({
      price: { amount: 3500000, currency: 'IDR' },
      available: 500,
      availability: 'available'
    });
    expect(response.body.expiresAt).toBeDefined();
    expect(response.body.maxTickets).toBe(3);
  });

  it('rejects the categories endpoint without an admission token', async () => {
    const { app, accountToken } = await createTestApp();
    const response = await request(app)
      .get('/v1/core/events/evt_2026_gbk/categories')
      .set('Authorization', `Bearer ${accountToken}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ADMISSION_INVALID');
  });
});
