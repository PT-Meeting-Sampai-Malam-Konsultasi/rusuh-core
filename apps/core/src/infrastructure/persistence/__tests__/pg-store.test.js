// PgStore with a fake pg Pool: the SQL + row mapping are verified without a
// live Postgres. The live integration (real DB) is covered by the local-dev
// real test, not here.
const { Pool } = require('pg');
const { PgStore } = require('@/infrastructure/persistence/store');

jest.mock('pg', () => ({
  Pool: jest.fn()
}));

const BOOKING_ROW = {
  booking_id: 'bk_1',
  event_id: 'evt_1',
  account_id: 'acc_1',
  admission_token: 'adm_1',
  slot_id: 's_1',
  status: 'SELECTION',
  expires_at: '2026-11-07T10:05:00.000Z',
  payment_expires_at: null,
  order_code: 'RSH-26-000001',
  price: '{"total":{"amount":100,"currency":"IDR"}}',
  attendees: '[]',
  tickets: null,
  snap_token: null,
  paid_at: null,
  payment_method: null,
  refund_required: false,
  created_at: '2026-11-07T10:00:00.000Z',
  updated_at: '2026-11-07T10:00:00.000Z'
};

const TICKET_ROW = {
  ticket_id: 'tk_1',
  ticket_code: 'SMD-FB-00001',
  booking_id: 'bk_1',
  event_id: 'evt_1',
  category_id: 'cat_1',
  category_name: 'Festival B',
  seating: 'Festival',
  entry_gate: 'Gate A',
  holder_name: 'Edy Supardi',
  nik_masked: '3171 •••• •••• 0001',
  qr_payload: 'RSH1.SMD-FB-00001.abc',
  issued_at: '2026-11-07T10:00:00.000Z'
};

function fakeClient({ queryImpl = async () => ({ rows: [] }) } = {}) {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (text, params) => {
      queries.push({ text, params });
      return queryImpl(text, params);
    }),
    release: jest.fn()
  };
}

/** A fake pg Pool: query() returns canned rows; connect() returns a fake client. */
function fakePool({ queryImpl = async () => ({ rows: [] }) } = {}) {
  const queries = [];
  const pool = {
    queries,
    query: jest.fn(async (text, params) => {
      queries.push({ text, params });
      return queryImpl(text, params);
    }),
    connect: jest.fn(async () => fakeClient({ queryImpl })),
    end: jest.fn(async () => {})
  };
  return pool;
}

describe('PgStore (live Postgres adapter, fake Pool)', () => {
  it('connect creates a Pool, probes it, and returns a PgStore', async () => {
    const probe = jest.fn(async () => ({ rows: [{ '?column?': 1 }] }));
    Pool.mockImplementation(() => ({ query: probe }));
    const store = await PgStore.connect('postgres://localhost:5432/rusuh');
    expect(store).toBeInstanceOf(PgStore);
    expect(Pool).toHaveBeenCalledWith({ connectionString: 'postgres://localhost:5432/rusuh', max: 10 });
    expect(probe).toHaveBeenCalledWith('SELECT 1');
  });

  it('listEvents returns the rows as-is', async () => {
    const row = { eventId: 'evt_1', name: 'Samudra' };
    const pool = fakePool({ queryImpl: async () => ({ rows: [row] }) });
    const store = new PgStore(pool);
    await expect(store.listEvents()).resolves.toEqual([row]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM events ORDER BY starts_at'));
  });

  it('getEvent returns the row or null', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [{ eventId: 'evt_1' }] }) });
    const store = new PgStore(pool);
    await expect(store.getEvent('evt_1')).resolves.toEqual({ eventId: 'evt_1' });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE event_id = $1'), ['evt_1']);

    const empty = fakePool({ queryImpl: async () => ({ rows: [] }) });
    await expect(new PgStore(empty).getEvent('evt_missing')).resolves.toBeNull();
  });

  it('getCategories returns rows ordered by price; getCategory returns one or null', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [{ categoryId: 'cat_1' }] }) });
    const store = new PgStore(pool);
    await expect(store.getCategories('evt_1')).resolves.toEqual([{ categoryId: 'cat_1' }]);
    await expect(store.getCategory('evt_1', 'cat_1')).resolves.toEqual({ categoryId: 'cat_1' });
    const empty = fakePool({ queryImpl: async () => ({ rows: [] }) });
    await expect(new PgStore(empty).getCategory('evt_1', 'cat_missing')).resolves.toBeNull();
  });

  it('createBooking inserts in a transaction and maps the row', async () => {
    const client = fakeClient({
      queryImpl: async (text) => {
        if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] };
        return { rows: [BOOKING_ROW] };
      }
    });
    const pool = fakePool();
    pool.connect = jest.fn(async () => client);
    const store = new PgStore(pool);
    const booking = {
      bookingId: 'bk_1',
      eventId: 'evt_1',
      accountId: 'acc_1',
      admissionToken: 'adm_1',
      slotId: 's_1',
      status: 'SELECTION',
      expiresAt: '2026-11-07T10:05:00.000Z',
      paymentExpiresAt: null,
      orderCode: 'RSH-26-000001',
      price: { total: { amount: 100, currency: 'IDR' } },
      attendees: [],
      snapToken: null
    };
    const created = await store.createBooking(booking);
    expect(created.bookingId).toBe('bk_1');
    expect(created.price).toEqual({ total: { amount: 100, currency: 'IDR' } });
    expect(created.attendees).toEqual([]);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('createBooking rolls back and releases on error', async () => {
    const client = fakeClient({
      queryImpl: async (text) => {
        if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] };
        throw new Error('duplicate key');
      }
    });
    const pool = fakePool();
    pool.connect = jest.fn(async () => client);
    const store = new PgStore(pool);
    await expect(store.createBooking({ bookingId: 'bk_1' })).rejects.toThrow('duplicate key');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('getBooking maps the row or returns null', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [BOOKING_ROW] }) });
    const store = new PgStore(pool);
    const booking = await store.getBooking('bk_1');
    expect(booking.bookingId).toBe('bk_1');
    expect(booking.expiresAt).toBe('2026-11-07T10:05:00.000Z');
    expect(booking.paymentExpiresAt).toBeNull();
    expect(booking.refundRequired).toBe(false);
    const empty = fakePool({ queryImpl: async () => ({ rows: [] }) });
    await expect(new PgStore(empty).getBooking('bk_missing')).resolves.toBeNull();
  });

  it('getActiveBookingByAdmission / ByAccountEvent / ByAccount map rows or return null', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [BOOKING_ROW] }) });
    const store = new PgStore(pool);
    await expect(store.getActiveBookingByAdmission('adm_1')).resolves.toMatchObject({ bookingId: 'bk_1' });
    await expect(store.getActiveBookingByAccountEvent('acc_1', 'evt_1')).resolves.toMatchObject({ bookingId: 'bk_1' });
    await expect(store.getActiveBookingsByAccount('acc_1')).resolves.toHaveLength(1);
    const empty = fakePool({ queryImpl: async () => ({ rows: [] }) });
    const emptyStore = new PgStore(empty);
    await expect(emptyStore.getActiveBookingByAdmission('adm_x')).resolves.toBeNull();
    await expect(emptyStore.getActiveBookingByAccountEvent('acc_1', 'evt_1')).resolves.toBeNull();
    await expect(emptyStore.getActiveBookingsByAccount('acc_1')).resolves.toEqual([]);
  });

  it('updateBookingStatus builds the SET clause from the patch and guards on from-status', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [BOOKING_ROW] }) });
    const store = new PgStore(pool);
    const updated = await store.updateBookingStatus('bk_1', 'SELECTION', 'PAYMENT_PENDING', {
      paymentExpiresAt: '2026-11-07T10:15:00.000Z',
      snapToken: 'snap_1',
      paidAt: '2026-11-07T10:10:00.000Z',
      paymentMethod: 'gopay',
      refundRequired: true,
      tickets: [{ ticketId: 'tk_1' }]
    });
    expect(updated.bookingId).toBe('bk_1');
    const [text, params] = pool.query.mock.calls[0];
    expect(text).toContain('payment_expires_at = $3');
    expect(text).toContain('snap_token = $4');
    expect(text).toContain('paid_at = $5');
    expect(text).toContain('payment_method = $6');
    expect(text).toContain('refund_required = $7');
    expect(text).toContain('tickets = $8');
    expect(text).toContain('status = ANY($9)');
    expect(params).toContain('bk_1');
    expect(params).toContain('PAYMENT_PENDING');
    expect(params).toContainEqual(['SELECTION']);

    // Array from-status + no patch + no row (already transitioned).
    const empty = fakePool({ queryImpl: async () => ({ rows: [] }) });
    const emptyStore = new PgStore(empty);
    await expect(
      emptyStore.updateBookingStatus('bk_1', ['SELECTION', 'PAYMENT_PENDING'], 'EXPIRED')
    ).resolves.toBeNull();
  });

  it('updateBooking builds the SET clause from camelCase patch keys', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [BOOKING_ROW] }) });
    const store = new PgStore(pool);
    await store.updateBooking('bk_1', { snapToken: 'snap_9', tickets: [{ ticketId: 'tk_1' }] });
    const [text, params] = pool.query.mock.calls[0];
    expect(text).toContain('snap_token = $2');
    expect(text).toContain('tickets = $3');
    expect(params[0]).toBe('bk_1');
    expect(params[1]).toBe('snap_9');
    expect(params[2]).toBe(JSON.stringify([{ ticketId: 'tk_1' }]));
    const empty = fakePool({ queryImpl: async () => ({ rows: [] }) });
    await expect(new PgStore(empty).updateBooking('bk_1', { snapToken: 'x' })).resolves.toBeNull();
  });

  it('mintTickets inserts each row in one transaction and maps them', async () => {
    const client = fakeClient({
      queryImpl: async (text) => {
        if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] };
        return { rows: [TICKET_ROW] };
      }
    });
    const pool = fakePool();
    pool.connect = jest.fn(async () => client);
    const store = new PgStore(pool);
    const minted = await store.mintTickets({ bookingId: 'bk_1', eventId: 'evt_1' }, [
      {
        ticketId: 'tk_1',
        ticketCode: 'SMD-FB-00001',
        categoryId: 'cat_1',
        categoryName: 'Festival B',
        seating: 'Festival',
        entryGate: 'Gate A',
        holderName: 'Edy Supardi',
        nikMasked: '3171 •••• •••• 0001',
        qrPayload: 'RSH1.SMD-FB-00001.abc'
      }
    ]);
    expect(minted).toHaveLength(1);
    expect(minted[0].ticketId).toBe('tk_1');
    expect(minted[0].entryGate).toBe('Gate A');
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('mintTickets rolls back and releases on error', async () => {
    const client = fakeClient({
      queryImpl: async (text) => {
        if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] };
        throw new Error('insert failed');
      }
    });
    const pool = fakePool();
    pool.connect = jest.fn(async () => client);
    const store = new PgStore(pool);
    await expect(store.mintTickets({ bookingId: 'bk_1', eventId: 'evt_1' }, [{ ticketId: 'tk_1' }])).rejects.toThrow(
      'insert failed'
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('listTicketsByAccount and getTicket map ticket rows or return null', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [TICKET_ROW] }) });
    const store = new PgStore(pool);
    const tickets = await store.listTicketsByAccount('acc_1');
    expect(tickets).toHaveLength(1);
    expect(tickets[0].ticketCode).toBe('SMD-FB-00001');
    await expect(store.getTicket('tk_1')).resolves.toMatchObject({ ticketId: 'tk_1' });
    const empty = fakePool({ queryImpl: async () => ({ rows: [] }) });
    await expect(new PgStore(empty).getTicket('tk_missing')).resolves.toBeNull();
  });

  it('nikSeatCount returns the count or 0', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [{ count: '2' }] }) });
    await expect(new PgStore(pool).nikSeatCount('evt_1', 'hmac_1')).resolves.toBe(2);
    const empty = fakePool({ queryImpl: async () => ({ rows: [] }) });
    await expect(new PgStore(empty).nikSeatCount('evt_1', 'hmac_1')).resolves.toBe(0);
  });

  it('incrementNikBackstop returns the new count and deletes the row at zero', async () => {
    const pool = fakePool({
      queryImpl: async (text) => {
        if (text.startsWith('DELETE')) return { rows: [] };
        return { rows: [{ count: '0' }] };
      }
    });
    const store = new PgStore(pool);
    await expect(store.incrementNikBackstop('evt_1', 'hmac_1', -1)).resolves.toBe(0);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM nik_backstop'), ['evt_1', 'hmac_1']);

    const pool2 = fakePool({ queryImpl: async () => ({ rows: [{ count: '3' }] }) });
    await expect(new PgStore(pool2).incrementNikBackstop('evt_1', 'hmac_1', 1)).resolves.toBe(3);
    expect(pool2.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM nik_backstop'),
      expect.anything()
    );
  });

  it('nextTicketSeq returns the new sequence value', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [{ last_value: '42' }] }) });
    await expect(new PgStore(pool).nextTicketSeq('evt_1', 'cat_1')).resolves.toBe(42);
  });

  it('logEmail returns true on insert, false on conflict (already logged)', async () => {
    const inserted = fakePool({ queryImpl: async () => ({ rowCount: 1 }) });
    await expect(new PgStore(inserted).logEmail('bk_1', 'e-ticket')).resolves.toBe(true);
    const conflict = fakePool({ queryImpl: async () => ({ rowCount: 0 }) });
    await expect(new PgStore(conflict).logEmail('bk_1', 'e-ticket')).resolves.toBe(false);
  });

  it('listDueBookings maps rows', async () => {
    const pool = fakePool({ queryImpl: async () => ({ rows: [BOOKING_ROW] }) });
    const store = new PgStore(pool);
    const due = await store.listDueBookings('2026-11-07T10:06:00.000Z', 100);
    expect(due).toHaveLength(1);
    expect(due[0].bookingId).toBe('bk_1');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('expires_at < $1'), [
      '2026-11-07T10:06:00.000Z',
      100
    ]);
  });

  it('close ends the pool', async () => {
    const pool = fakePool();
    const store = new PgStore(pool);
    await store.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
