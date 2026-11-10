const request = require('supertest');
const { createTestApp } = require('@/test-helpers');

describe('POST /v1/auth/otp + /v1/auth/otp/verify', () => {
  let app;
  let dependencies;

  beforeEach(() => {
    ({ app, dependencies } = createTestApp());
  });

  afterEach(async () => {
    await dependencies.store.close();
  });

  it('POST /v1/auth/otp returns 202 with a challenge id', async () => {
    const response = await request(app).post('/v1/auth/otp').send({ email: 'rina@example.com' });
    expect(response.status).toBe(202);
    expect(response.body.challengeId).toMatch(/^ch_/);
    expect(response.body.expiresAt).toBeTruthy();
    expect(response.body.resendAfterSeconds).toBe(60);
    expect(dependencies.mailer.sent).toHaveLength(1);
  });

  it('POST /v1/auth/otp with fullName returns 400 (name is set after login)', async () => {
    const response = await request(app).post('/v1/auth/otp').send({ email: 'rina@example.com', fullName: 'Rina' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(dependencies.mailer.sent).toHaveLength(0);
  });

  it('POST /v1/auth/otp/request (LLD-01 alias) works the same', async () => {
    const response = await request(app).post('/v1/auth/otp/request').send({ email: 'budi@example.com' });
    expect(response.status).toBe(202);
    expect(response.body.challengeId).toMatch(/^ch_/);
  });

  it('POST /v1/auth/otp with an invalid email returns 400 Problem JSON', async () => {
    const response = await request(app).post('/v1/auth/otp').send({ email: 'not-an-email' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(response.body.status).toBe(400);
  });

  it('POST /v1/auth/otp twice within 60 s returns 429', async () => {
    await request(app).post('/v1/auth/otp').send({ email: 'caca@example.com' });
    const response = await request(app).post('/v1/auth/otp').send({ email: 'caca@example.com' });
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('TOO_MANY_REQUESTS');
    expect(response.body.status).toBe(429);
  });

  it('POST /v1/auth/otp/verify logs in and sets the __Host-rt cookie', async () => {
    const requested = await request(app).post('/v1/auth/otp').send({ email: 'dewi@example.com' });
    const { code } = dependencies.mailer.sent[0];
    const response = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challengeId: requested.body.challengeId, code });
    expect(response.status).toBe(200);
    expect(response.body.isNewAccount).toBe(true);
    expect(response.body.expiresIn).toBe(900);
    expect(response.body.user.email).toBe('dewi@example.com');
    expect(response.body.user.fullName).toBeNull();
    expect(response.headers['set-cookie'][0]).toMatch(/__Host-rt=/);
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  it('POST /v1/auth/otp/verify with a wrong code returns 409 WRONG_CODE + attemptsLeft', async () => {
    const requested = await request(app).post('/v1/auth/otp').send({ email: 'eko@example.com' });
    const response = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challengeId: requested.body.challengeId, code: '000000' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('WRONG_CODE');
    expect(response.body.attemptsLeft).toBe(4);
  });

  it('POST /v1/auth/otp/verify with a bad code format returns 400', async () => {
    const requested = await request(app).post('/v1/auth/otp').send({ email: 'fajar@example.com' });
    const response = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challengeId: requested.body.challengeId, code: 'abc' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('POST /v1/auth/otp/verify with an unknown challenge returns 410', async () => {
    const response = await request(app).post('/v1/auth/otp/verify').send({ challengeId: 'ch_nope', code: '123456' });
    expect(response.status).toBe(410);
    expect(response.body.code).toBe('CHALLENGE_EXPIRED');
  });
});
