const { createOfficerUseCase } = require('../officer.use-case');
const { TEST_NIK, makeTicket, makeEvent, makeOfficerDeps, todayJakarta } = require('./test-fixtures');

describe('officer service', () => {
  it('lookup returns the masked ticket (never the full NIK)', async () => {
    const deps = makeOfficerDeps();
    const service = createOfficerUseCase(deps);
    const ticket = await service.lookupTicket('SMD-FB-04827');
    expect(ticket.ticketCode).toBe('SMD-FB-04827');
    expect(ticket.nikMasked).toBe('3171 •••• •••• 0001');
    expect(ticket).not.toHaveProperty('nikFull');
    expect(ticket).not.toHaveProperty('nikCipher');
    expect(ticket.status).toBe('unused');
  });

  it('lookup accepts the internal ticket id too', async () => {
    const deps = makeOfficerDeps();
    const service = createOfficerUseCase(deps);
    const ticket = await service.lookupTicket('tk_01JB2YBA1');
    expect(ticket.ticketCode).toBe('SMD-FB-04827');
  });

  it('lookup of an unknown code throws 404 TIKET_TIDAK_DITEMUKAN', async () => {
    const deps = makeOfficerDeps();
    const service = createOfficerUseCase(deps);
    await expect(service.lookupTicket('SMD-XX-00000')).rejects.toMatchObject({
      data: { code: 'TIKET_TIDAK_DITEMUKAN' }
    });
  });

  it('scan reveals the full NIK and marks the ticket used', async () => {
    const deps = makeOfficerDeps();
    const service = createOfficerUseCase(deps);
    const scanned = await service.scanTicket('SMD-FB-04827', { officerId: 'acc_officer_1' });
    expect(scanned.nikFull).toBe(TEST_NIK);
    expect(scanned.status).toBe('used');
    expect(scanned.usedBy).toBe('acc_officer_1');
    expect(scanned.usedAt).toBeTruthy();

    const audits = await deps.auditStore.list();
    const actions = audits.map((entry) => entry.action);
    expect(actions).toEqual(['NIK_REVEALED', 'TICKET_MARKED_USED']);
    // The audit records THAT the full NIK was viewed — never its value.
    expect(JSON.stringify(audits)).not.toContain(TEST_NIK);
    expect(audits[0].nikMasked).toBe('3171 •••• •••• 0001');
    expect(audits[0].actorAccountId).toBe('acc_officer_1');
  });

  it('a repeat scan is idempotent (same result, not an error) and still audited', async () => {
    const deps = makeOfficerDeps();
    const service = createOfficerUseCase(deps);
    const first = await service.scanTicket('SMD-FB-04827', { officerId: 'acc_officer_1' });
    const second = await service.scanTicket('SMD-FB-04827', { officerId: 'acc_officer_1' });
    expect(second.status).toBe('used');
    expect(second.nikFull).toBe(TEST_NIK);
    expect(second.usedAt).toBe(first.usedAt);
    expect(second.usedBy).toBe(first.usedBy);

    const audits = await deps.auditStore.list();
    const rejected = audits.filter((entry) => entry.action === 'SCAN_REJECTED');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].details).toEqual({ reason: 'already_used', idempotent: true });
  });

  it('scan of an unknown code throws 404 and writes no audit', async () => {
    const deps = makeOfficerDeps();
    const service = createOfficerUseCase(deps);
    await expect(service.scanTicket('SMD-XX-00000', { officerId: 'acc_officer_1' })).rejects.toMatchObject({
      data: { code: 'TIKET_TIDAK_DITEMUKAN' }
    });
    expect(await deps.auditStore.list()).toHaveLength(0);
  });

  it('scan outside the event date throws 409 TIKET_TIDAK_BERLAKU', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Jakarta'
    });
    const deps = makeOfficerDeps({
      tickets: [makeTicket({ eventDate: yesterday })],
      events: [makeEvent({ date: yesterday })]
    });
    const service = createOfficerUseCase(deps);
    await expect(service.scanTicket('SMD-FB-04827', { officerId: 'acc_officer_1' })).rejects.toMatchObject({
      data: { code: 'TIKET_TIDAK_BERLAKU' }
    });
    const audits = await deps.auditStore.list();
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('SCAN_REJECTED');
    expect(audits[0].details.reason).toBe('not_valid_date');
  });

  it('scan warns on a gate mismatch but still marks the ticket used', async () => {
    const deps = makeOfficerDeps();
    const service = createOfficerUseCase(deps);
    const scanned = await service.scanTicket('SMD-FB-04827', { officerId: 'acc_officer_1', gate: 'Gerbang 2' });
    expect(scanned.status).toBe('used');
    expect(scanned.gateWarning).toEqual({ expectedGate: 'Gerbang 5', scannedAtGate: 'Gerbang 2' });
  });

  it('scan with a broken NIK cipher throws 503 (no decrypt bypass)', async () => {
    const deps = makeOfficerDeps({ tickets: [makeTicket({ nikCipher: 'not-a-cipher' })] });
    const service = createOfficerUseCase(deps);
    await expect(service.scanTicket('SMD-FB-04827', { officerId: 'acc_officer_1' })).rejects.toMatchObject({
      data: { code: 'SERVICE_UNAVAILABLE' }
    });
  });

  it('listAttendees returns masked tickets with pagination meta', async () => {
    const tickets = [
      makeTicket(),
      makeTicket({
        id: 'tk_01JB2YBA2',
        publicCode: 'SMD-FB-04828',
        nik: '3271010202850003',
        holderName: 'Dimas Pratama'
      })
    ];
    const deps = makeOfficerDeps({ tickets });
    const service = createOfficerUseCase(deps);
    const page1 = await service.listAttendees('evt_2026_gbk', { page: 1, limit: 1 });
    expect(page1.meta).toEqual({ total: 2, page: 1, limit: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.data[0].nikMasked).toBe('3171 •••• •••• 0001');
    expect(page1.data[0]).not.toHaveProperty('nikFull');

    const page2 = await service.listAttendees('evt_2026_gbk', { page: 2, limit: 1 });
    expect(page2.data[0].holderName).toBe('Dimas Pratama');
  });

  it('listAttendees of an unknown event throws 404 NOT_FOUND', async () => {
    const deps = makeOfficerDeps();
    const service = createOfficerUseCase(deps);
    await expect(service.listAttendees('evt_nope', { page: 1, limit: 50 })).rejects.toMatchObject({
      data: { code: 'NOT_FOUND' }
    });
  });

  it('todayInJakarta returns a YYYY-MM-DD date', () => {
    expect(todayJakarta()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
