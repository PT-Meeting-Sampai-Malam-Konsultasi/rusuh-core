const request = require('supertest');
const { createTestApp } = require('@/test-app');

const SERVICE_KEY = 'test-service-key';

function validBody(overrides = {}) {
  return {
    admission_token: 'adm_route_1',
    user_id: 'acc_1',
    event_id: 'evt_2026_gbk',
    slot_id: 's_route_1',
    max_tickets: 2,
    expires_at: new Date(Date.now() + 16 * 60 * 1000).toISOString(),
    ...overrides
  };
}

describe('POST /v1/core/admission (registerAdmission, synchronous; ADR-0027)', () => {
  it('stores a valid admission and returns 200 {stored:true}', async () => {
    const { app, deps } = await createTestApp();
    const response = await request(app).post('/v1/core/admission').set('x-service-key', SERVICE_KEY).send(validBody());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stored: true });
    const stored = await deps.stock.getAdmission('adm_route_1');
    expect(stored).toMatchObject({ user_id: 'acc_1', event_id: 'evt_2026_gbk', max_tickets: 2 });
  });

  it('is idempotent: registering the same token twice returns 200 both times', async () => {
    const { app, deps } = await createTestApp();
    const first = await request(app).post('/v1/core/admission').set('x-service-key', SERVICE_KEY).send(validBody());
    const second = await request(app).post('/v1/core/admission').set('x-service-key', SERVICE_KEY).send(validBody());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ stored: true });
    const stored = await deps.stock.getAdmission('adm_route_1');
    expect(stored).toMatchObject({ user_id: 'acc_1' });
  });

  it('rejects a missing service key with 401', async () => {
    const { app } = await createTestApp();
    const response = await request(app).post('/v1/core/admission').send(validBody());
    expect(response.status).toBe(401);
  });

  it('rejects a wrong service key with 401', async () => {
    const { app } = await createTestApp();
    const response = await request(app).post('/v1/core/admission').set('x-service-key', 'wrong-key').send(validBody());
    expect(response.status).toBe(401);
  });

  it('rejects an invalid body with 400 (missing admission_token)', async () => {
    const { app } = await createTestApp();
    const body = validBody();
    delete body.admission_token;
    const response = await request(app).post('/v1/core/admission').set('x-service-key', SERVICE_KEY).send(body);
    expect(response.status).toBe(400);
  });

  it('rejects an invalid expires_at with 400 (not ISO 8601)', async () => {
    const { app } = await createTestApp();
    const response = await request(app)
      .post('/v1/core/admission')
      .set('x-service-key', SERVICE_KEY)
      .send(validBody({ expires_at: 'not-a-date' }));
    expect(response.status).toBe(400);
  });

  it('rejects max_tickets outside 1..3 with 400', async () => {
    const { app } = await createTestApp();
    const tooMany = await request(app)
      .post('/v1/core/admission')
      .set('x-service-key', SERVICE_KEY)
      .send(validBody({ max_tickets: 4 }));
    expect(tooMany.status).toBe(400);
    const zero = await request(app)
      .post('/v1/core/admission')
      .set('x-service-key', SERVICE_KEY)
      .send(validBody({ max_tickets: 0 }));
    expect(zero.status).toBe(400);
  });
});
