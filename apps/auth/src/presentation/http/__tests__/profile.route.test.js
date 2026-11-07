const request = require('supertest');
const { createTestApp, loginViaOtp } = require('@/test-helpers');

describe('GET /v1/me + /v1/auth/profile', () => {
  let app;
  let dependencies;

  beforeEach(() => {
    ({ app, dependencies } = createTestApp());
  });

  afterEach(async () => {
    await dependencies.store.close();
  });

  it('GET /v1/me returns the profile for a valid token', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'rina@example.com', 'Rina');
    const response = await request(app).get('/v1/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({ userId: session.user.userId, email: 'rina@example.com', fullName: 'Rina' })
    );
  });

  it('GET /v1/auth/profile (LLD-01 alias) returns the same profile', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'budi@example.com', 'Budi');
    const response = await request(app).get('/v1/auth/profile').set('Authorization', `Bearer ${session.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.fullName).toBe('Budi');
  });

  it('GET /v1/me without a token returns 401 Problem JSON', async () => {
    const response = await request(app).get('/v1/me');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(response.body.status).toBe(401);
  });

  it('GET /v1/me with a malformed token returns 401', async () => {
    const response = await request(app).get('/v1/me').set('Authorization', 'Bearer not.a.token');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('PUT /v1/auth/profile completes the profile (name only, no NIK)', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'caca@example.com');
    expect(session.user.fullName).toBeNull();
    const response = await request(app)
      .put('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ fullName: 'Caca Marica' });
    expect(response.status).toBe(200);
    expect(response.body.fullName).toBe('Caca Marica');
    const me = await request(app).get('/v1/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.body.fullName).toBe('Caca Marica');
  });

  it('PUT /v1/auth/profile with an empty name returns 400', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'dewi@example.com');
    const response = await request(app)
      .put('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ fullName: '' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('PUT /v1/auth/profile without a token returns 401', async () => {
    const response = await request(app).put('/v1/auth/profile').send({ fullName: 'X' });
    expect(response.status).toBe(401);
  });
});
