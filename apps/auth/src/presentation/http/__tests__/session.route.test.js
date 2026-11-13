const request = require('supertest');
const { createTestApp, loginViaOtp } = require('@/test-helpers');

describe('POST /v1/auth/refresh + POST /v1/auth/logout', () => {
  let app;
  let dependencies;

  beforeEach(() => {
    ({ app, dependencies } = createTestApp());
  });

  afterEach(async () => {
    await dependencies.store.close();
  });

  it('POST /v1/auth/refresh rotates tokens (body)', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'rina@example.com');
    const response = await request(app).post('/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(response.status).toBe(200);
    expect(response.body.accessToken).not.toBe(session.accessToken);
    expect(response.body.refreshToken).not.toBe(session.refreshToken);
    expect(response.body.user.userId).toBe(session.user.userId);
  });

  it('POST /v1/auth/refresh reads the __Host-rt cookie (web)', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'budi@example.com');
    const response = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `__Host-rt=${session.refreshToken}`)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
  });

  it('POST /v1/auth/refresh rotates the cookie with the same __Host- attributes', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'hana@example.com');
    const response = await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `__Host-rt=${session.refreshToken}`)
      .send({});
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toMatch(/^__Host-rt=/);
    expect(cookie).toMatch(/; Path=\/(;|$)/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('POST /v1/auth/logout clears the cookie on the path it was set', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'ines@example.com');
    const response = await request(app).post('/v1/auth/logout').set('Authorization', `Bearer ${session.accessToken}`);
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toMatch(/^__Host-rt=;/);
    expect(cookie).toMatch(/; Path=\/(;|$)/);
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('POST /v1/auth/refresh without a token returns 401', async () => {
    const response = await request(app).post('/v1/auth/refresh').send({});
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('POST /v1/auth/refresh reuse revokes the family (401 + rotated token dead)', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'caca@example.com');
    const rotated = await request(app).post('/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const reuse = await request(app).post('/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(reuse.status).toBe(401);
    const dead = await request(app).post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
    expect(dead.status).toBe(401);
  });

  it('POST /v1/auth/logout returns 204 and the access token stops working', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'dewi@example.com');
    const response = await request(app).post('/v1/auth/logout').set('Authorization', `Bearer ${session.accessToken}`);
    expect(response.status).toBe(204);
    const me = await request(app).get('/v1/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('UNAUTHORIZED');
    const refresh = await request(app).post('/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('POST /v1/auth/logout without a token returns 401', async () => {
    const response = await request(app).post('/v1/auth/logout');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });
});
