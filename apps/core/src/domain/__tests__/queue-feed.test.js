const {
  saleDocument,
  feedTtlMs,
  isListed,
  deviceIdFromAdmissionToken,
  bookingEvent,
  bookingEventGap
} = require('@/domain/queue-feed');

const EVENT = {
  eventId: 'evt_2026_gbk',
  state: 'on_sale',
  waitingRoomOpensAt: '2026-11-14T02:30:00.000Z',
  saleOpensAt: '2026-11-14T03:00:00.000Z',
  saleEndsAt: '2026-11-20T16:59:59.000Z'
};

function token(payload) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'EdDSA', typ: 'admission' })}.${part(payload)}.c2ln`;
}

describe('sale document (shared-keys.md, core:{evt}:sale)', () => {
  it('carries the times the queue parses', () => {
    expect(saleDocument(EVENT, new Date('2026-11-13T00:00:00Z'))).toEqual({
      v: 1,
      eventId: 'evt_2026_gbk',
      status: 'published',
      waitingRoomOpensAt: '2026-11-14T02:30:00.000Z',
      saleOpensAt: '2026-11-14T03:00:00.000Z',
      endsAt: '2026-11-20T16:59:59.000Z',
      updatedAt: '2026-11-13T00:00:00.000Z'
    });
  });

  it('opens the waiting room at the sale when no waiting-room time is set', () => {
    const doc = saleDocument({ ...EVENT, waitingRoomOpensAt: null }, new Date());
    expect(doc.waitingRoomOpensAt).toBe('2026-11-14T03:00:00.000Z');
  });

  it.each([
    ['a draft', { state: 'draft' }],
    ['no sale time', { saleOpensAt: null }],
    ['no end', { saleEndsAt: null }],
    ['an end before the sale', { saleEndsAt: '2026-11-14T02:00:00Z' }],
    ['an id the queue cannot key', { eventId: 'evt:1' }]
  ])('is null for %s', (_name, patch) => {
    expect(saleDocument({ ...EVENT, ...patch }, new Date())).toBeNull();
  });

  it('lives until a day after the sale ends', () => {
    const now = new Date('2026-11-20T16:59:59.000Z');
    expect(feedTtlMs(EVENT, now)).toBe(24 * 60 * 60 * 1000);
  });
});

describe('listing (core:events)', () => {
  it.each([
    ['before the waiting room opens', '2026-11-14T02:29:59Z', false],
    ['when the waiting room opens', '2026-11-14T02:30:00Z', true],
    ['during the sale', '2026-11-15T00:00:00Z', true],
    ['when the sale ends', '2026-11-20T16:59:59Z', false]
  ])('%s: %s', (_name, at, listed) => {
    expect(isListed(EVENT, new Date(at))).toBe(listed);
  });

  it('never lists a draft', () => {
    expect(isListed({ ...EVENT, state: 'draft' }, new Date('2026-11-15T00:00:00Z'))).toBe(false);
  });
});

describe('device id from the admission token', () => {
  it('reads the sub the queue signed', () => {
    expect(deviceIdFromAdmissionToken(token({ sub: 'w_lCphzERtHxSl8yRoXHcx0g' }))).toBe('w_lCphzERtHxSl8yRoXHcx0g');
  });

  it.each([
    ['not a jwt', 'adm_1'],
    ['a sub that is not a device', token({ sub: 'acc_1' })],
    ['no sub', token({ event: 'evt_1' })],
    ['a payload that is not json', 'a.bm90IGpzb24.c']
  ])('is null for %s', (_name, raw) => {
    expect(deviceIdFromAdmissionToken(raw)).toBeNull();
  });
});

describe('booking event (booking.v1 on stream:booking)', () => {
  const booking = {
    bookingId: 'bk_1',
    eventId: 'evt_2026_gbk',
    slotId: 's_1',
    deviceId: 'w_lCphzERtHxSl8yRoXHcx0g',
    paymentExpiresAt: '2026-11-14T03:15:00.000Z',
    attendees: [{}, {}]
  };
  const now = new Date('2026-11-14T03:05:00.000Z');

  it('builds booking.held with the payment deadline', () => {
    const event = bookingEvent('booking.held', booking, now);
    expect(event).toEqual({
      v: 1,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: 'booking.held',
      eventId: 'evt_2026_gbk',
      slotId: 's_1',
      deviceId: 'w_lCphzERtHxSl8yRoXHcx0g',
      bookingId: 'bk_1',
      units: 2,
      paymentDeadline: '2026-11-14T03:15:00.000Z',
      occurredAt: '2026-11-14T03:05:00.000Z'
    });
  });

  it.each(['booking.paid', 'booking.expired'])('builds %s without a deadline', (type) => {
    const event = bookingEvent(type, booking, now);
    expect(event.type).toBe(type);
    expect(event).not.toHaveProperty('paymentDeadline');
  });

  it('gives every event its own id', () => {
    expect(bookingEvent('booking.paid', booking, now).id).not.toBe(bookingEvent('booking.paid', booking, now).id);
  });

  it.each([
    ['no device', { deviceId: null }],
    ['no slot', { slotId: null }],
    ['an event id the queue cannot key', { eventId: 'evt:1' }]
  ])('is null for a booking with %s (the queue would dead-letter it)', (_name, patch) => {
    expect(bookingEvent('booking.paid', { ...booking, ...patch }, now)).toBeNull();
  });

  it.each([
    ['deviceId', { deviceId: null }],
    ['slotId', { slotId: null }],
    ['eventId', { eventId: 'evt:1' }]
  ])('names %s as the field the queue cannot use', (field, patch) => {
    expect(bookingEventGap({ ...booking, ...patch })).toBe(field);
  });

  it('names no field for a booking the queue can use', () => {
    expect(bookingEventGap(booking)).toBeNull();
  });
});
