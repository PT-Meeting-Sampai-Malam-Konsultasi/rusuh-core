const { makeTicket, makeEvent } = require('@/application/officer/__tests__/test-fixtures');
const { createMemoryTicketStore } = require('../ticket-store');

describe('memory ticket store', () => {
  it('finds a ticket by public code and by internal id', async () => {
    const store = createMemoryTicketStore([makeTicket()], [makeEvent()]);
    expect((await store.findByCodeOrId('SMD-FB-04827')).id).toBe('tk_01JB2YBA1');
    expect((await store.findByCodeOrId('tk_01JB2YBA1')).publicCode).toBe('SMD-FB-04827');
    expect(await store.findByCodeOrId('SMD-XX-00000')).toBeNull();
  });

  it('markUsed is atomic and idempotent (second call reports alreadyUsed)', async () => {
    const store = createMemoryTicketStore([makeTicket()], [makeEvent()]);
    const first = await store.markUsed('SMD-FB-04827', { usedBy: 'acc_officer_1' });
    expect(first.alreadyUsed).toBe(false);
    expect(first.ticket.status).toBe('used');
    expect(first.ticket.usedBy).toBe('acc_officer_1');

    const second = await store.markUsed('SMD-FB-04827', { usedBy: 'acc_officer_2' });
    expect(second.alreadyUsed).toBe(true);
    expect(second.ticket.usedBy).toBe('acc_officer_1');
  });

  it('markUsed of an unknown ticket returns null', async () => {
    const store = createMemoryTicketStore([], []);
    expect(await store.markUsed('SMD-XX-00000', { usedBy: 'acc_officer_1' })).toBeNull();
  });

  it('listByEvent paginates', async () => {
    const tickets = [
      makeTicket(),
      makeTicket({ id: 'tk_01JB2YBA2', publicCode: 'SMD-FB-04828', holderName: 'Dimas Pratama' }),
      makeTicket({ id: 'tk_01JB2YBA3', publicCode: 'SMD-FB-04829', holderName: 'Sari', eventId: 'evt_other' })
    ];
    const store = createMemoryTicketStore(tickets, [makeEvent()]);
    const page = await store.listByEvent('evt_2026_gbk', { page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    const page2 = await store.listByEvent('evt_2026_gbk', { page: 2, limit: 1 });
    expect(page2.items[0].holderName).toBe('Dimas Pratama');
  });

  it('findEvent returns null for an unknown event', async () => {
    const store = createMemoryTicketStore([], []);
    expect(await store.findEvent('evt_nope')).toBeNull();
  });
});
