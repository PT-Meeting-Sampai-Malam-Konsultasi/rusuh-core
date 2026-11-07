const request = require('supertest');
const { createTestApp } = require('@/test-helpers');

describe('admin fees routes', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  const admin = (req) => req.set('Authorization', 'Bearer admin-token');

  it('GET /v1/admin/config/fees returns the default config', async () => {
    const response = await admin(request(app).get('/v1/admin/config/fees'));
    expect(response.status).toBe(200);
    expect(response.body.platform_fee).toBe(30000);
    expect(response.body.admin_fee).toBeNull();
    expect(response.body.tax1_rate).toBe(0.11);
    expect(response.body.tax2.label).toBe('Pajak Lainnya');
  });

  it('PUT /v1/admin/config/fees updates the config', async () => {
    const response = await admin(
      request(app)
        .put('/v1/admin/config/fees')
        .send({ platform_fee: 25000, tax2: { rate: 0.1, label: 'PBJT Hiburan' } })
    );
    expect(response.status).toBe(200);
    expect(response.body.platform_fee).toBe(25000);
    expect(response.body.tax2).toEqual({ rate: 0.1, base: 'platform_fee', label: 'PBJT Hiburan' });
  });

  it('PUT /v1/admin/config/fees rejects a negative platform fee', async () => {
    const response = await admin(request(app).put('/v1/admin/config/fees').send({ platform_fee: -1 }));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/v1/admin/config/fees');
    expect(response.status).toBe(401);
  });
});
