const { createAdmissionUseCase } = require('@/application/admission/admission.use-case');
const { MemoryStock } = require('@/infrastructure/cache/stock');

describe('admission use case (registerAdmission, synchronous; ADR-0027)', () => {
  it('requires a stock', () => {
    expect(() => createAdmissionUseCase({})).toThrow('createAdmissionUseCase requires stock');
    expect(() => createAdmissionUseCase()).toThrow('createAdmissionUseCase requires stock');
  });

  it('stores a valid admission and returns stored:true', async () => {
    const stock = new MemoryStock();
    const useCase = createAdmissionUseCase({ stock });
    const admission = {
      admission_token: 'adm_1',
      user_id: 'acc_1',
      event_id: 'evt_1',
      slot_id: 's_1',
      max_tickets: 2,
      expires_at: new Date(Date.now() + 600000).toISOString()
    };
    await expect(useCase.registerAdmission(admission)).resolves.toEqual({ stored: true });
    const stored = await stock.getAdmission('adm_1');
    expect(stored).toMatchObject({ user_id: 'acc_1', event_id: 'evt_1', slot_id: 's_1', max_tickets: 2 });
  });

  it('defaults max_tickets and expires_at when missing', async () => {
    const stock = new MemoryStock();
    const useCase = createAdmissionUseCase({ stock });
    await expect(
      useCase.registerAdmission({ admission_token: 'adm_2', user_id: 'acc_2', event_id: 'evt_1' })
    ).resolves.toEqual({ stored: true });
    const stored = await stock.getAdmission('adm_2');
    expect(stored.max_tickets).toBe(3);
    expect(stored.slot_id).toBeNull();
    expect(stored.expires_at).toBeDefined();
  });

  it('is idempotent: storing the same token twice overwrites with the same entry', async () => {
    const stock = new MemoryStock();
    const useCase = createAdmissionUseCase({ stock });
    const admission = {
      admission_token: 'adm_3',
      user_id: 'acc_3',
      event_id: 'evt_1',
      slot_id: 's_3',
      max_tickets: 1,
      expires_at: new Date(Date.now() + 600000).toISOString()
    };
    await expect(useCase.registerAdmission(admission)).resolves.toEqual({ stored: true });
    await expect(useCase.registerAdmission(admission)).resolves.toEqual({ stored: true });
    const stored = await stock.getAdmission('adm_3');
    expect(stored).toMatchObject({ user_id: 'acc_3', max_tickets: 1 });
  });

  it('caps the stored TTL at ttlMs (same rule the old consumer used)', async () => {
    const stock = new MemoryStock();
    const useCase = createAdmissionUseCase({ stock, ttlMs: 60000 });
    const before = Date.now();
    await useCase.registerAdmission({
      admission_token: 'adm_4',
      user_id: 'acc_4',
      event_id: 'evt_1',
      slot_id: 's_4',
      max_tickets: 1,
      expires_at: new Date(Date.now() + 600000).toISOString()
    });
    // The entry is stored, but its expiry is capped at ~60 s (not 10 min).
    const record = stock.admissions.get('adm_4');
    expect(record).toBeDefined();
    expect(record.expiresAtMs - before).toBeLessThanOrEqual(61000);
    expect(record.expiresAtMs - before).toBeGreaterThan(0);
  });
});
