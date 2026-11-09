/**
 * Decided constants (decisions file + ADR-0021–0026, 5–6 Nov 2026).
 * Durations are in milliseconds unless the name says otherwise.
 */
module.exports = Object.freeze({
  ACCESS_TOKEN_TTL_MS: 15 * 60 * 1000,
  REFRESH_TOKEN_TTL_DAYS: 7,
  PAYMENT_TTL_MS: 10 * 60 * 1000,
  MAX_SEATS_PER_NIK: 3,
  MAX_TICKETS_PER_ORDER: 3,
  PPN_RATE: 0.11,
  SQS_QUEUES: Object.freeze({
    admission: 'rusuh-{env}-admission',
    emptySlot: 'rusuh-{env}-empty-slot',
    notification: 'rusuh-{env}-notification'
  }),
  VALKEY_NAMESPACES: Object.freeze({
    queue: 'queue:',
    stock: 'stock:',
    nik: 'nik:',
    ticket: 'ticket:',
    denylist: 'denylist:',
    cap: 'cap:'
  })
});
