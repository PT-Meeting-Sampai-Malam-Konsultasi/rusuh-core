const request = require('supertest');
const { createTestApp } = require('@/test-helpers');

describe('admin bookings routes', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  const admin = (req) => req.set('Authorization', 'Bearer admin-token');

  it('GET /v1/admin/bookings/:id returns the booking with masked NIK', async () => {
    const response = await admin(request(app).get('/v1/admin/bookings/bk_held_1'));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PAYMENT_PENDING');
    expect(response.body.tickets).toHaveLength(2);
    expect(response.body.tickets[0].nik_masked).toBe('3171****0001');
    expect(JSON.stringify(response.body)).not.toContain('3171010101900001');
  });

  it('GET /v1/admin/bookings/:id returns 404 for an unknown booking', async () => {
    const response = await admin(request(app).get('/v1/admin/bookings/bk_nope'));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('GET /v1/admin/refund-flags returns the seeded flag (yaml shape)', async () => {
    const response = await admin(request(app).get('/v1/admin/refund-flags'));
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      bookingId: 'bk_paid_late_1',
      orderId: 'bk_paid_late_1-2',
      reason: 'paid_after_expiry',
      amount: { amount: 1515000, currency: 'IDR' }
    });
  });

  it('GET /v1/admin/refund-flags filters by eventId', async () => {
    const response = await admin(request(app).get('/v1/admin/refund-flags?eventId=evt_other'));
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(0);
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/v1/admin/refund-flags');
    expect(response.status).toBe(401);
  });
});
