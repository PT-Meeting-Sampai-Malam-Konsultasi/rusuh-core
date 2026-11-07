const request = require('supertest');
const { hmacNik } = require('@/domain/nik');
const { createTestApp } = require('@/test-app');

describe('POST /v1/events/:eventId/attendees/validate', () => {
  const validBody = { fieldIndex: 0, fullName: 'Edy Supardi', nik: '3171010101900001' };

  it('validates a NIK and returns a validationToken + nikMasked', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const response = await request(app)
      .post('/v1/events/evt_2026_gbk/attendees/validate')
      .set('Authorization', `Bearer ${accountToken}`)
      .set('X-Admission-Token', admissionToken)
      .send(validBody);
    expect(response.status).toBe(200);
    expect(response.body.validationToken).toMatch(/^av_/);
    expect(response.body.nikMasked).toBe('3171 •••• •••• 0001');
    expect(response.body.expiresAt).toBeDefined();
  });

  it('rejects a 16-digit NIK with an impossible birth date (422 NIK_INVALID)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const response = await request(app)
      .post('/v1/events/evt_2026_gbk/attendees/validate')
      .set('Authorization', `Bearer ${accountToken}`)
      .set('X-Admission-Token', admissionToken)
      .send({ fieldIndex: 0, fullName: 'Edy Supardi', nik: '3171013202900001' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('NIK_INVALID');
  });

  it('rejects a non-16-digit NIK at the schema level (400 VALIDATION_FAILED)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const response = await request(app)
      .post('/v1/events/evt_2026_gbk/attendees/validate')
      .set('Authorization', `Bearer ${accountToken}`)
      .set('X-Admission-Token', admissionToken)
      .send({ fieldIndex: 0, fullName: 'Edy Supardi', nik: '31710101019000' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('blocks a negative Dukcapil verdict (422 NIK_INVALID, item 4)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp({
      dukcapilValid: false,
      dukcapilReason: 'NIK_NOT_FOUND'
    });
    const response = await request(app)
      .post('/v1/events/evt_2026_gbk/attendees/validate')
      .set('Authorization', `Bearer ${accountToken}`)
      .set('X-Admission-Token', admissionToken)
      .send(validBody);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('NIK_INVALID');
  });

  it('rejects a duplicate NIK in the same order (409 DUPLICATE_NIK)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    await request(app).post('/v1/events/evt_2026_gbk/attendees/validate').set(headers).send(validBody);
    const response = await request(app).post('/v1/events/evt_2026_gbk/attendees/validate').set(headers).send(validBody);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_NIK');
  });

  it('rejects a NIK that already holds 3 seats (409 NIK_SEAT_TAKEN)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    // Seed the backstop: 3 seats already held for this NIK.
    await app.locals.deps.store.incrementNikBackstop(
      'evt_2026_gbk',
      hmacNik('3171010101900001', 'rusuh-dev-nik-hmac-key'),
      3
    );
    const response = await request(app)
      .post('/v1/events/evt_2026_gbk/attendees/validate')
      .set('Authorization', `Bearer ${accountToken}`)
      .set('X-Admission-Token', admissionToken)
      .send(validBody);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('NIK_SEAT_TAKEN');
  });

  it('rejects a request without an admission token (403 ADMISSION_INVALID)', async () => {
    const { app, accountToken } = await createTestApp();
    const response = await request(app)
      .post('/v1/events/evt_2026_gbk/attendees/validate')
      .set('Authorization', `Bearer ${accountToken}`)
      .send(validBody);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ADMISSION_INVALID');
  });

  it('rejects a request without an account token (401 UNAUTHORIZED)', async () => {
    const { app, admissionToken } = await createTestApp();
    const response = await request(app)
      .post('/v1/events/evt_2026_gbk/attendees/validate')
      .set('X-Admission-Token', admissionToken)
      .send(validBody);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });
});
