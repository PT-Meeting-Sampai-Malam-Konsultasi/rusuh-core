const request = require('supertest');
const { createTestApp, loginViaOtp } = require('@/test-helpers');

describe('GET /v1/internal/accounts/:accountId (service key)', () => {
  let app;
  let dependencies;

  beforeEach(async () => {
    ({ app, dependencies } = createTestApp({ SERVICE_KEY: 'test-internal-key' }));
  });

  afterEach(async () => {
    await dependencies.store.close();
  });

  it('returns the buyer e-mail + locale for core-module (no name needed)', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'buyer@example.com');
    await request(app)
      .put('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ fullName: 'Rina Pembeli', locale: 'en' });

    const response = await request(app)
      .get(`/v1/internal/accounts/${session.user.userId}`)
      .set('x-service-key', 'test-internal-key');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: session.user.userId,
      email: 'buyer@example.com',
      locale: 'en',
      fullName: 'Rina Pembeli'
    });
  });

  it('rejects a missing or wrong service key (fail-closed)', async () => {
    const session = await loginViaOtp(app, dependencies.mailer, 'buyer2@example.com');
    const noKey = await request(app).get(`/v1/internal/accounts/${session.user.userId}`);
    expect(noKey.status).toBe(401);
    const wrongKey = await request(app)
      .get(`/v1/internal/accounts/${session.user.userId}`)
      .set('x-service-key', 'wrong');
    expect(wrongKey.status).toBe(401);
  });

  it('returns 404 for an unknown account', async () => {
    await loginViaOtp(app, dependencies.mailer, 'buyer3@example.com');
    const response = await request(app)
      .get('/v1/internal/accounts/acc_missing')
      .set('x-service-key', 'test-internal-key');
    expect(response.status).toBe(404);
  });
});
