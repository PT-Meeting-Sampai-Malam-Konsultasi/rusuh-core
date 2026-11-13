const http = require('http');
const request = require('supertest');
const { createCoreClient } = require('../../../payment/src/infrastructure/external/core-client');
const { createTestApp } = require('../test-app');

/**
 * Contract test: payment's real core client (real fetch, real HTTP) against the
 * real core Express app. A drift in path, credential header or body between the
 * two modules fails here (payment-result notifications never reached core).
 */
const SERVICE_KEY = 'contract-service-key';
const ATTENDEE = { fieldIndex: 0, fullName: 'Edy Supardi', nik: '3171010101900001' };
const GROSS = 1533300;

let server;
let baseUrl;
let app;
let deps;
let headers;

async function newPaymentPendingBooking() {
  const harness = await createTestApp({ serviceKey: SERVICE_KEY });
  app = harness.app;
  deps = harness.deps;
  headers = { Authorization: `Bearer ${harness.accountToken}`, 'X-Admission-Token': harness.admissionToken };
  const validate = await request(app)
    .post('/v1/core/events/evt_2026_gbk/attendees/validate')
    .set(headers)
    .send(ATTENDEE);
  const create = await request(app)
    .post('/v1/core/bookings')
    .set(headers)
    .send({
      eventId: 'evt_2026_gbk',
      tickets: [{ categoryId: 'cat_festival_b', validationToken: validate.body.validationToken }]
    });
  const { bookingId } = create.body;
  const payment = await request(app).post(`/v1/core/bookings/${bookingId}/payment`).set(headers).send();
  expect(payment.status).toBe(200);
  return bookingId;
}

async function listen() {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    server = undefined;
  }
});

function notification(bookingId, overrides = {}) {
  return {
    bookingId,
    orderId: `${bookingId}-1`,
    transactionId: 'tx-1',
    transactionStatus: 'settlement',
    paymentType: 'qris',
    grossAmount: GROSS,
    ...overrides
  };
}

describe('payment core client -> core router', () => {
  it('a settlement is accepted: handled true and the booking becomes PAID', async () => {
    const bookingId = await newPaymentPendingBooking();
    await listen();
    const client = createCoreClient({ baseUrl, credential: SERVICE_KEY, timeoutMs: 2000 });
    const result = await client.notifyPaymentResult(notification(bookingId));
    expect(result).toMatchObject({ handled: true, late: false, duplicate: false, reason: null });
    expect((await deps.store.getBooking(bookingId)).status).toBe('PAID');
  });

  it('a repeated notification is a duplicate, not an error', async () => {
    const bookingId = await newPaymentPendingBooking();
    await listen();
    const client = createCoreClient({ baseUrl, credential: SERVICE_KEY, timeoutMs: 2000 });
    await client.notifyPaymentResult(notification(bookingId));
    await expect(client.notifyPaymentResult(notification(bookingId))).resolves.toMatchObject({
      handled: true,
      duplicate: true
    });
  });

  it.each([
    ['no credential', undefined],
    ['a wrong credential', 'wrong-key']
  ])('is rejected with 401 for %s', async (_name, credential) => {
    const bookingId = await newPaymentPendingBooking();
    await listen();
    const client = createCoreClient({ baseUrl, credential, timeoutMs: 2000 });
    await expect(client.notifyPaymentResult(notification(bookingId))).rejects.toMatchObject({
      name: 'CoreClientError',
      status: 401
    });
    expect((await deps.store.getBooking(bookingId)).status).toBe('PAYMENT_PENDING');
  });

  it('the legacy header X-Service-Credential is not accepted', async () => {
    const bookingId = await newPaymentPendingBooking();
    await listen();
    const response = await fetch(`${baseUrl}/v1/internal/bookings/${bookingId}/payment-result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Service-Credential': SERVICE_KEY },
      body: JSON.stringify(notification(bookingId))
    });
    expect(response.status).toBe(401);
  });

  it.each(['deny', 'cancel', 'failure', 'pending', 'expire'])(
    'a %s notification is answered handled:false (not_confirmed) and changes nothing',
    async (transactionStatus) => {
      const bookingId = await newPaymentPendingBooking();
      await listen();
      const client = createCoreClient({ baseUrl, credential: SERVICE_KEY, timeoutMs: 2000 });
      await expect(client.notifyPaymentResult(notification(bookingId, { transactionStatus }))).resolves.toMatchObject({
        handled: false,
        reason: 'not_confirmed'
      });
      expect((await deps.store.getBooking(bookingId)).status).toBe('PAYMENT_PENDING');
    }
  );

  it('an unknown booking is handled:false with reason not_found (HTTP 200, no retry)', async () => {
    await newPaymentPendingBooking();
    await listen();
    const client = createCoreClient({ baseUrl, credential: SERVICE_KEY, timeoutMs: 2000 });
    await expect(client.notifyPaymentResult(notification('bk_missing'))).resolves.toMatchObject({
      handled: false,
      reason: 'not_found'
    });
  });

  it('an amount that differs from the booking total is handled:false (amount_mismatch)', async () => {
    const bookingId = await newPaymentPendingBooking();
    await listen();
    const client = createCoreClient({ baseUrl, credential: SERVICE_KEY, timeoutMs: 2000 });
    await expect(client.notifyPaymentResult(notification(bookingId, { grossAmount: 1 }))).resolves.toMatchObject({
      handled: false,
      reason: 'amount_mismatch'
    });
  });

  it('a settlement after the booking expired is handled:true with late:true', async () => {
    const bookingId = await newPaymentPendingBooking();
    const booking = await deps.store.getBooking(bookingId);
    await deps.store.updateBookingStatus(bookingId, 'PAYMENT_PENDING', 'EXPIRED', {}, null);
    expect(booking.status).toBe('PAYMENT_PENDING');
    await listen();
    const client = createCoreClient({ baseUrl, credential: SERVICE_KEY, timeoutMs: 2000 });
    await expect(client.notifyPaymentResult(notification(bookingId))).resolves.toMatchObject({
      handled: true,
      late: true,
      actionTaken: 'paid_after_expiry'
    });
  });
});
