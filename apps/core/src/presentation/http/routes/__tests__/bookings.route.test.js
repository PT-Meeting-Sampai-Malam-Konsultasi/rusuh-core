const request = require('supertest');
const { createTestApp } = require('@/test-app');

const ATTENDEE = { fieldIndex: 0, fullName: 'Edy Supardi', nik: '3171010101900001' };

/** Validates one attendee and returns the validation token. */
async function validateAttendee(app, headers) {
  const response = await request(app).post('/v1/events/evt_2026_gbk/attendees/validate').set(headers).send(ATTENDEE);
  expect(response.status).toBe(200);
  return response.body.validationToken;
}

/** Creates a SELECTION booking for one Festival B ticket. */
async function createBooking(app, headers, validationToken) {
  return request(app)
    .post('/v1/bookings')
    .set(headers)
    .send({
      eventId: 'evt_2026_gbk',
      tickets: [{ categoryId: 'cat_festival_b', validationToken }]
    });
}

describe('bookings journey (D5)', () => {
  it('runs the full journey: validate -> SELECTION -> PAYMENT_PENDING -> PAID -> tickets', async () => {
    const { app, admissionToken, accountToken } = await createTestApp({
      payment: {
        status: { status: 'settlement', grossAmount: 1548300, transactionId: 'txn_1', paymentType: 'gopay' }
      }
    });
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };

    // 1. Validate the attendee.
    const validationToken = await validateAttendee(app, headers);

    // 2. Create the booking (SELECTION, 5 min).
    const create = await createBooking(app, headers, validationToken);
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({
      status: 'SELECTION',
      eventId: 'evt_2026_gbk',
      orderCode: expect.stringMatching(/^RSH-\d{2}-\d{6}$/)
    });
    expect(create.body.price.ticketSubtotal).toEqual({ amount: 1500000, currency: 'IDR' });
    expect(create.body.price.total).toEqual({ amount: 1548300, currency: 'IDR' });
    expect(create.body.attendees[0].nikMasked).toBe('3171 •••• •••• 0001');
    const { bookingId } = create.body;

    // 3. Re-creating with the same admission is idempotent (200, same booking).
    const again = await createBooking(app, headers, validationToken);
    expect(again.status).toBe(200);
    expect(again.body.bookingId).toBe(bookingId);

    // 4. Enter payment (PAYMENT_PENDING, 10 min, snap token).
    const payment = await request(app).post(`/v1/bookings/${bookingId}/payment`).set(headers).send();
    expect(payment.status).toBe(200);
    expect(payment.body).toMatchObject({ bookingId, snapToken: 'stub-snap-token' });
    expect(payment.body.paymentExpiresAt).toBeDefined();

    // 5. Entering payment again is idempotent (same snap token).
    const paymentAgain = await request(app).post(`/v1/bookings/${bookingId}/payment`).set(headers).send();
    expect(paymentAgain.status).toBe(200);
    expect(paymentAgain.body.snapToken).toBe('stub-snap-token');

    // 6. Check-status confirms the settlement (ADR-0008) -> PAID + tickets.
    const status = await request(app).post(`/v1/bookings/${bookingId}/check-status`).set(headers).send();
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('PAID');
    expect(status.body.tickets).toHaveLength(1);
    expect(status.body.tickets[0].ticketCode).toBe('SMD-FB-00001');

    // 7. Tickets are listed (paid only, D19).
    const tickets = await request(app).get('/v1/tickets').set('Authorization', `Bearer ${accountToken}`);
    expect(tickets.status).toBe(200);
    expect(tickets.body.items).toHaveLength(1);
    expect(tickets.body.items[0].nikMasked).toBe('3171 •••• •••• 0001');
    expect(tickets.body.items[0].qrPayload).toMatch(/^RSH1\.SMD-FB-00001\./);

    const { ticketId } = tickets.body.items[0];
    const ticket = await request(app).get(`/v1/tickets/${ticketId}`).set('Authorization', `Bearer ${accountToken}`);
    expect(ticket.status).toBe(200);
    expect(ticket.body.ticketId).toBe(ticketId);

    // 8. The booking is readable by the account.
    const fetched = await request(app).get(`/v1/bookings/${bookingId}`).set('Authorization', `Bearer ${accountToken}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.status).toBe('PAID');
  });

  it('rejects a booking with an invalid validation token (409 ATTENDEE_NOT_VALIDATED)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const response = await request(app)
      .post('/v1/bookings')
      .set(headers)
      .send({ eventId: 'evt_2026_gbk', tickets: [{ categoryId: 'cat_festival_b', validationToken: 'av_bogus' }] });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ATTENDEE_NOT_VALIDATED');
  });

  it('rejects more tickets than the admission allows (409 QUANTITY_OVER_RESERVATION)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp({
      admission: {
        user_id: 'acc_01',
        event_id: 'evt_2026_gbk',
        slot_id: 's_test01JB7Q9K2M',
        max_tickets: 2,
        expires_at: new Date(Date.now() + 16 * 60 * 1000).toISOString()
      }
    });
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const validationToken = await validateAttendee(app, headers);
    const response = await request(app)
      .post('/v1/bookings')
      .set(headers)
      .send({
        eventId: 'evt_2026_gbk',
        tickets: [1, 2, 3].map(() => ({ categoryId: 'cat_festival_b', validationToken }))
      });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('QUANTITY_OVER_RESERVATION');
  });

  it('rejects payment entry after the SELECTION TTL (409 BOOKING_NOT_HELD)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const validationToken = await validateAttendee(app, headers);
    const create = await createBooking(app, headers, validationToken);
    const { bookingId } = create.body;
    // Force the SELECTION to expire.
    await app.locals.deps.store.updateBooking(bookingId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const response = await request(app).post(`/v1/bookings/${bookingId}/payment`).set(headers).send();
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('BOOKING_NOT_HELD');
  });

  it('expires a due booking via the sweeper (empty-slot + expired email)', async () => {
    const { app, admissionToken, accountToken, deps } = await createTestApp();
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const validationToken = await validateAttendee(app, headers);
    const create = await createBooking(app, headers, validationToken);
    const { bookingId } = create.body;
    await request(app).post(`/v1/bookings/${bookingId}/payment`).set(headers).send();
    // Force the payment deadline to pass.
    await app.locals.deps.store.updateBooking(bookingId, {
      paymentExpiresAt: new Date(Date.now() - 1000).toISOString()
    });
    const result = await deps.useCases.bookings.expireDue();
    expect(result.processed).toBe(1);
    expect((await deps.store.getBooking(bookingId)).status).toBe('EXPIRED');
    // The hold was released back to available.
    expect(await deps.stock.getAvailable('evt_2026_gbk', 'cat_festival_b')).toBe(8000);
    // An empty-slot event was published and an expired email enqueued.
    expect(deps.eventBus.emptySlotEvents).toHaveLength(1);
    expect(deps.eventBus.emptySlotEvents[0].reason).toBe('expired');
    expect(deps.eventBus.emailJobs).toHaveLength(1);
    expect(deps.eventBus.emailJobs[0].type).toBe('expired');
  });

  it('accepts a payment-result webhook (service key) and mints tickets', async () => {
    const { app, admissionToken, accountToken, deps } = await createTestApp();
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const validationToken = await validateAttendee(app, headers);
    const create = await createBooking(app, headers, validationToken);
    const { bookingId } = create.body;
    const payment = await request(app).post(`/v1/bookings/${bookingId}/payment`).set(headers).send();
    expect(payment.status).toBe(200);

    // Wrong service key -> 401.
    const bad = await request(app)
      .post(`/v1/internal/bookings/${bookingId}/payment-result`)
      .set('X-Service-Key', 'wrong-key')
      .send({
        orderId: `${bookingId}-1`,
        transactionStatus: 'settlement',
        grossAmount: 1548300,
        transactionId: 'txn_9'
      });
    expect(bad.status).toBe(401);

    const result = await request(app)
      .post(`/v1/internal/bookings/${bookingId}/payment-result`)
      .set('X-Service-Key', 'test-service-key')
      .send({
        orderId: `${bookingId}-1`,
        transactionStatus: 'settlement',
        grossAmount: 1548300,
        transactionId: 'txn_9'
      });
    expect(result.status).toBe(200);
    expect(result.body.handled).toBe(true);
    expect((await deps.store.getBooking(bookingId)).status).toBe('PAID');
    // Duplicate webhook -> duplicate:true, no double tickets.
    const duplicate = await request(app)
      .post(`/v1/internal/bookings/${bookingId}/payment-result`)
      .set('X-Service-Key', 'test-service-key')
      .send({
        orderId: `${bookingId}-1`,
        transactionStatus: 'settlement',
        grossAmount: 1548300,
        transactionId: 'txn_9'
      });
    expect(duplicate.body.handled).toBe(true);
    expect(duplicate.body.duplicate).toBe(true);
    expect(await deps.store.listTicketsByAccount('acc_01')).toHaveLength(1);
  });

  it('returns 404 for a booking belonging to another account', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const validationToken = await validateAttendee(app, headers);
    const create = await createBooking(app, headers, validationToken);
    const { bookingId } = create.body;
    // Another account (a different Bearer token) with no admission for this booking.
    const response = await request(app)
      .get(`/v1/bookings/${bookingId}`)
      .set('Authorization', 'Bearer other-account-token');
    expect(response.status).toBe(404);
    // The owner can still read it.
    const owner = await request(app).get(`/v1/bookings/${bookingId}`).set('Authorization', `Bearer ${accountToken}`);
    expect(owner.status).toBe(200);
  });

  it('lists the active booking (resume)', async () => {
    const { app, admissionToken, accountToken } = await createTestApp();
    const headers = { Authorization: `Bearer ${accountToken}`, 'X-Admission-Token': admissionToken };
    const validationToken = await validateAttendee(app, headers);
    const create = await createBooking(app, headers, validationToken);
    const active = await request(app).get('/v1/bookings/active').set('Authorization', `Bearer ${accountToken}`);
    expect(active.status).toBe(200);
    expect(active.body.items).toHaveLength(1);
    expect(active.body.items[0].bookingId).toBe(create.body.bookingId);
  });
});
