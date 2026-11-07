const { createNikCrypto, maskNik } = require('@/domain/nik');
const { createMemoryTicketStore } = require('@/infrastructure/persistence/ticket-store');
const { createMemoryAuditStore } = require('@/infrastructure/persistence/audit-store');

/**
 * Test fixtures for the officer module. Not a test file.
 * The NIK key is a fixed test key (never a real key).
 */

const TEST_NIK_KEY = Buffer.alloc(32, 7);
const TEST_NIK = '3171010101900001';
const TEST_NIK_2 = '3271010202850003';

function todayJakarta() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function makeNikCrypto() {
  return createNikCrypto({ key: TEST_NIK_KEY });
}

/**
 * Builds a ticket record (as the store returns it).
 *
 * @param {object} [overrides] - Field overrides.
 * @returns {object} Ticket record.
 */
function makeTicket(overrides = {}) {
  const nikCrypto = makeNikCrypto();
  const nik = overrides.nik || TEST_NIK;
  return {
    id: 'tk_01JB2YBA1',
    publicCode: 'SMD-FB-04827',
    bookingId: 'bk_01JB2Y6Z8Q',
    eventId: 'evt_2026_gbk',
    eventName: 'Rusuh Festival 2026',
    eventDate: todayJakarta(),
    categoryId: 'cat_festival_b',
    categoryName: 'Festival B',
    gate: 'Gerbang 5',
    seating: 'standing',
    holderName: 'Rina Wulandari',
    nikMasked: maskNik(nik),
    nikCipher: nikCrypto.encrypt(nik),
    status: 'unused',
    usedAt: null,
    usedBy: null,
    issuedAt: '2026-11-14T10:46:00Z',
    ...overrides
  };
}

function makeEvent(overrides = {}) {
  return { id: 'evt_2026_gbk', name: 'Rusuh Festival 2026', date: todayJakarta(), ...overrides };
}

/**
 * Builds an officer dependency set (in-memory stores + test NIK key).
 *
 * @param {object} [options]
 * @param {object[]} [options.tickets] - Seed tickets.
 * @param {object[]} [options.events] - Seed events.
 * @param {object} [options.roles] - Map accountId -> role.
 * @returns {object} { ticketStore, auditStore, nikCrypto, verifyToken, roleResolver }
 */
function makeOfficerDeps({ tickets = [makeTicket()], events = [makeEvent()], roles = {} } = {}) {
  const ticketStore = createMemoryTicketStore(tickets, events);
  const auditStore = createMemoryAuditStore();
  const nikCrypto = makeNikCrypto();
  const verifyToken = async (token) => {
    if (token === 'valid-officer-token') return { sub: 'acc_officer_1', jti: 'jti-1', exp: 9999999999 };
    if (token === 'valid-customer-token') return { sub: 'acc_customer_1', jti: 'jti-2', exp: 9999999999 };
    const error = new Error('Bad signature');
    error.code = 'UNAUTHORIZED';
    throw error;
  };
  const roleResolver = async (accountId) =>
    roles[accountId] || (accountId === 'acc_officer_1' ? 'officer' : 'customer');
  return { ticketStore, auditStore, nikCrypto, verifyToken, roleResolver };
}

module.exports = {
  TEST_NIK,
  TEST_NIK_2,
  TEST_NIK_KEY,
  todayJakarta,
  makeNikCrypto,
  makeTicket,
  makeEvent,
  makeOfficerDeps
};
