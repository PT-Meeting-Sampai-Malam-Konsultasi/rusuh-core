const request = require('supertest');
const { createTestApp, loginViaOtp } = require('@/test-helpers');

describe('POST /v1/auth/email-change + /verify', () => {
  let app;
  let dependencies;
  let session;

  const auth = () => ({ Authorization: `Bearer ${session.accessToken}` });

  beforeEach(async () => {
    ({ app, dependencies } = createTestApp());
    session = await loginViaOtp(app, dependencies.mailer, 'old@example.com');
  });

  afterEach(async () => {
    await dependencies.store.close();
  });

  const start = (newEmail = 'new@example.com') =>
    request(app).post('/v1/auth/email-change').set(auth()).send({ newEmail });

  it('start sends one code to each address and returns 202 + challengeId', async () => {
    const before = dependencies.mailer.sent.length;
    const response = await start();
    expect(response.status).toBe(202);
    expect(response.body.challengeId).toEqual(expect.any(String));
    const sent = dependencies.mailer.sent.slice(before);
    expect(sent.map((s) => s.to)).toEqual(['old@example.com', 'new@example.com']);
  });

  it('verify with both codes changes the email and returns the User', async () => {
    const before = dependencies.mailer.sent.length;
    const { body } = await start();
    const [oldMail, newMail] = dependencies.mailer.sent.slice(before);
    const response = await request(app)
      .post('/v1/auth/email-change/verify')
      .set(auth())
      .send({ challengeId: body.challengeId, oldEmailCode: oldMail.code, newEmailCode: newMail.code });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ userId: session.user.userId, email: 'new@example.com' }));
    const me = await request(app).get('/v1/me').set(auth());
    expect(me.body.email).toBe('new@example.com');
  });

  it('verify with a wrong code returns 409 WRONG_CODE and keeps the email', async () => {
    const before = dependencies.mailer.sent.length;
    const { body } = await start();
    const [oldMail] = dependencies.mailer.sent.slice(before);
    const wrong = oldMail.code === '000000' ? '000001' : '000000';
    const response = await request(app)
      .post('/v1/auth/email-change/verify')
      .set(auth())
      .send({ challengeId: body.challengeId, oldEmailCode: oldMail.code, newEmailCode: wrong });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('WRONG_CODE');
    const me = await request(app).get('/v1/me').set(auth());
    expect(me.body.email).toBe('old@example.com');
  });

  it('start rejects the current email with 400', async () => {
    expect((await start('old@example.com')).status).toBe(400);
  });

  it('start rejects an email owned by another account with 409', async () => {
    await loginViaOtp(app, dependencies.mailer, 'taken@example.com');
    expect((await start('taken@example.com')).status).toBe(409);
  });

  it('start inside the resend cooldown returns 429', async () => {
    await start();
    expect((await start('other@example.com')).status).toBe(429);
  });

  it('verify with a malformed body returns 400', async () => {
    const response = await request(app)
      .post('/v1/auth/email-change/verify')
      .set(auth())
      .send({ challengeId: 'x', oldEmailCode: '12', newEmailCode: '123456' });
    expect(response.status).toBe(400);
  });

  it('verify with another account challenge returns 410', async () => {
    const before = dependencies.mailer.sent.length;
    const { body } = await start();
    const [oldMail, newMail] = dependencies.mailer.sent.slice(before);
    const other = await loginViaOtp(app, dependencies.mailer, 'other@example.com');
    const response = await request(app)
      .post('/v1/auth/email-change/verify')
      .set({ Authorization: `Bearer ${other.accessToken}` })
      .send({ challengeId: body.challengeId, oldEmailCode: oldMail.code, newEmailCode: newMail.code });
    expect(response.status).toBe(410);
  });

  it('both endpoints require a token (401)', async () => {
    expect((await request(app).post('/v1/auth/email-change').send({ newEmail: 'a@example.com' })).status).toBe(401);
    expect((await request(app).post('/v1/auth/email-change/verify').send({})).status).toBe(401);
  });

  it('start returns 503 and drops the challenge when the mailer fails', async () => {
    dependencies.mailer.failNext();
    const response = await start();
    expect(response.status).toBe(503);
    expect((await start()).status).toBe(202);
  });
});
