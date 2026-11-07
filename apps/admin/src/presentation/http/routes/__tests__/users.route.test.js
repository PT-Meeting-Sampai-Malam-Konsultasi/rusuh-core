const request = require('supertest');
const { createTestApp } = require('@/test-helpers');

describe('admin users routes', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  const admin = (req) => req.set('Authorization', 'Bearer admin-token');

  it('GET /v1/admin/users lists users with pagination meta', async () => {
    const response = await admin(request(app).get('/v1/admin/users'));
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.meta).toEqual({ total: 3, page: 1, limit: 20 });
    expect(response.body.data[0]).toHaveProperty('role');
  });

  it('GET /v1/admin/users filters by role', async () => {
    const response = await admin(request(app).get('/v1/admin/users?role=admin'));
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].email).toBe('admin@rusuh.id');
  });

  it('GET /v1/admin/users paginates', async () => {
    const response = await admin(request(app).get('/v1/admin/users?page=2&limit=2'));
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(3);
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/v1/admin/users');
    expect(response.status).toBe(401);
  });
});
