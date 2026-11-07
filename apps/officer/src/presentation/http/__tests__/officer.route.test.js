const request = require('supertest');
const { loadEnvironment } = require('@/infrastructure/config/environment');
const { createApp } = require('@/app');
const { TEST_NIK, makeOfficerDeps } = require('@/application/officer/__tests__/test-fixtures');

describe('officer routes', () => {
  const buildApp = (deps) => createApp({ config: loadEnvironment({}), officerDeps: deps });

  it('GET /v1/officer/tickets/:id without a token returns 401 UNAUTHORIZED', async () => {
    const app = buildApp(makeOfficerDeps());
    const response = await request(app).get('/v1/officer/tickets/SMD-FB-04827');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('GET /v1/officer/tickets/:id with a customer token returns 403 FORBIDDEN', async () => {
    const app = buildApp(makeOfficerDeps());
    const response = await request(app)
      .get('/v1/officer/tickets/SMD-FB-04827')
      .set('Authorization', 'Bearer valid-customer-token');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('GET /v1/officer/tickets/:id with an officer token returns the masked ticket', async () => {
    const app = buildApp(makeOfficerDeps());
    const response = await request(app)
      .get('/v1/officer/tickets/SMD-FB-04827')
      .set('Authorization', 'Bearer valid-officer-token');
    expect(response.status).toBe(200);
    expect(response.body.ticketCode).toBe('SMD-FB-04827');
    expect(response.body.nikMasked).toBe('3171 •••• •••• 0001');
    expect(response.body).not.toHaveProperty('nikFull');
  });

  it('GET an unknown ticket returns 404 TIKET_TIDAK_DITEMUKAN', async () => {
    const app = buildApp(makeOfficerDeps());
    const response = await request(app)
      .get('/v1/officer/tickets/SMD-XX-00000')
      .set('Authorization', 'Bearer valid-officer-token');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('TIKET_TIDAK_DITEMUKAN');
    expect(response.body.title).toBe('Ticket not found');
  });

  it('POST /v1/officer/tickets/:id/scan reveals the full NIK and marks used', async () => {
    const deps = makeOfficerDeps();
    const app = buildApp(deps);
    const response = await request(app)
      .post('/v1/officer/tickets/SMD-FB-04827/scan')
      .set('Authorization', 'Bearer valid-officer-token')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.nikFull).toBe(TEST_NIK);
    expect(response.body.status).toBe('used');
    expect(response.body.usedBy).toBe('acc_officer_1');
    expect(await deps.auditStore.list()).toHaveLength(2);
  });

  it('POST scan twice is idempotent (200, same usedAt)', async () => {
    const deps = makeOfficerDeps();
    const app = buildApp(deps);
    const first = await request(app)
      .post('/v1/officer/tickets/SMD-FB-04827/scan')
      .set('Authorization', 'Bearer valid-officer-token')
      .send({});
    const second = await request(app)
      .post('/v1/officer/tickets/SMD-FB-04827/scan')
      .set('Authorization', 'Bearer valid-officer-token')
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.usedAt).toBe(first.body.usedAt);
    expect(second.body.nikFull).toBe(TEST_NIK);
  });

  it('POST scan with a gate mismatch returns a gateWarning', async () => {
    const app = buildApp(makeOfficerDeps());
    const response = await request(app)
      .post('/v1/officer/tickets/SMD-FB-04827/scan')
      .set('Authorization', 'Bearer valid-officer-token')
      .send({ gate: 'Gerbang 2' });
    expect(response.status).toBe(200);
    expect(response.body.gateWarning).toEqual({ expectedGate: 'Gerbang 5', scannedAtGate: 'Gerbang 2' });
  });

  it('GET /v1/officer/events/:id/attendees returns a paginated masked list', async () => {
    const app = buildApp(makeOfficerDeps());
    const response = await request(app)
      .get('/v1/officer/events/evt_2026_gbk/attendees?page=1&limit=50')
      .set('Authorization', 'Bearer valid-officer-token');
    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ total: 1, page: 1, limit: 50 });
    expect(response.body.data[0].nikMasked).toBe('3171 •••• •••• 0001');
    expect(response.body.data[0]).not.toHaveProperty('nikFull');
  });

  it('GET attendees of an unknown event returns 404 NOT_FOUND', async () => {
    const app = buildApp(makeOfficerDeps());
    const response = await request(app)
      .get('/v1/officer/events/evt_nope/attendees')
      .set('Authorization', 'Bearer valid-officer-token');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('an invalid bearer token returns 401', async () => {
    const app = buildApp(makeOfficerDeps());
    const response = await request(app).get('/v1/officer/tickets/SMD-FB-04827').set('Authorization', 'Bearer nope');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });
});
