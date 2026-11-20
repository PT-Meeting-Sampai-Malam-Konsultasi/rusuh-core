const request = require('supertest');
const { createTestApp } = require('@/test-app');

/** Validates one attendee and returns the opaque token required to create a booking. */
async function validateAttendee(app, headers) {
  const response = await request(app).post('/v1/core/events/evt_2026_gbk/attendees/validate').set(headers).send({
    fieldIndex: 0,
    fullName: 'Rina Wulandari',
    nik: '3171010101900001'
  });
  return response.body.validationToken;
}

describe('public payment facade', () => {
  it('serves the payment-domain view, Snap transaction and status for the booking owner', async () => {
    const { app, admissionToken, accountToken } = await createTestApp({ midtransClientKey: 'SB-Mid-client-test' });
    const bookingHeaders = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const validationToken = await validateAttendee(app, bookingHeaders);
    const created = await request(app)
      .post('/v1/core/bookings')
      .set(bookingHeaders)
      .send({ eventId: 'evt_2026_gbk', tickets: [{ categoryId: 'cat_festival_b', validationToken }] });
    const { bookingId } = created.body;
    const accountHeaders = { Authorization: `Bearer ${accountToken}` };

    const page = await request(app).get(`/v1/payment/payments/${bookingId}`).set(accountHeaders);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      bookingId,
      eventName: 'Samudra',
      currentSnap: null,
      snapClientKey: 'SB-Mid-client-test'
    });

    const snap = await request(app).post(`/v1/payment/payments/${bookingId}/snap`).set(accountHeaders).send();
    expect(snap.status).toBe(201);
    expect(snap.body).toMatchObject({
      attemptId: 1,
      orderId: `${bookingId}-1`,
      snapToken: 'stub-snap-token'
    });

    const refreshed = await request(app).get(`/v1/payment/payments/${bookingId}`).set(accountHeaders);
    expect(refreshed.body.currentSnap).toMatchObject({ snapToken: 'stub-snap-token', orderId: `${bookingId}-1` });

    const status = await request(app).get(`/v1/payment/payments/${bookingId}/status`).set(accountHeaders);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ bookingStatus: 'PAYMENT_PENDING', paymentStatus: 'pending' });
  });

  it('hides another account booking behind the public payment facade', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const validationToken = await validateAttendee(app, headers);
    const created = await request(app)
      .post('/v1/core/bookings')
      .set(headers)
      .send({ eventId: 'evt_2026_gbk', tickets: [{ categoryId: 'cat_festival_b', validationToken }] });
    const response = await request(app)
      .get(`/v1/payment/payments/${created.body.bookingId}`)
      .set('Authorization', 'Bearer other-account-token');
    expect(response.status).toBe(404);
  });
});
