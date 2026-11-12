const { createMemoryStore } = require('@/infrastructure/persistence/memory-store');
const { createProfileUseCase } = require('../profile.use-case');

async function buildUseCase() {
  const store = createMemoryStore();
  const logger = { info: jest.fn(), error: jest.fn() };
  const useCase = createProfileUseCase({ store, logger });
  const account = await store.createAccount({ email: 'a@example.com' });
  return { useCase, store, logger, account };
}

describe('profile.use-case', () => {
  it('getMe returns the user with a null fullName before completion', async () => {
    const { useCase, account } = await buildUseCase();
    const user = await useCase.getMe({ accountId: account.id });
    expect(user).toEqual({ userId: account.id, email: 'a@example.com', fullName: null, locale: 'id', nikMasked: null });
  });

  it('updateProfile sets the name, marks the profile complete, and audits it', async () => {
    const { useCase, store, logger, account } = await buildUseCase();
    const user = await useCase.updateProfile({ accountId: account.id, fullName: 'Rina Wulandari', locale: 'id' });
    expect(user.fullName).toBe('Rina Wulandari');
    expect(user.nikMasked).toBeNull();
    const updated = await store.findAccountById(account.id);
    expect(updated.profileComplete).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('profile_completed');
    expect(store._auditLog).toHaveLength(1);
    expect(store._auditLog[0].action).toBe('profile_completed');
  });

  it('updateProfile stores an optional NIK encrypted and returns it masked', async () => {
    const { useCase, store, account } = await buildUseCase();
    const user = await useCase.updateProfile({
      accountId: account.id,
      fullName: 'Nadia Saputri',
      nik: '3174 0552 0396 0004'
    });
    expect(user.nikMasked).toBe('3174 •••• •••• 0004');
    const profile = await store.findProfile(account.id);
    expect(profile.nikCiphertext).toBeTruthy();
    expect(profile.nikCiphertext).not.toContain('3174055203960004');
    expect(profile.nikMasked).toBe('3174 •••• •••• 0004');
    const again = await useCase.getMe({ accountId: account.id });
    expect(again.nikMasked).toBe('3174 •••• •••• 0004');
  });

  it('updateProfile leaves the stored NIK unchanged when nik is omitted', async () => {
    const { useCase, account } = await buildUseCase();
    await useCase.updateProfile({ accountId: account.id, fullName: 'Nadia Saputri', nik: '3174055203960004' });
    const user = await useCase.updateProfile({ accountId: account.id, fullName: 'Nadia S.' });
    expect(user.nikMasked).toBe('3174 •••• •••• 0004');
  });

  it('updateProfile clears the stored NIK when nik is null', async () => {
    const { useCase, account } = await buildUseCase();
    await useCase.updateProfile({ accountId: account.id, fullName: 'Nadia Saputri', nik: '3174055203960004' });
    const user = await useCase.updateProfile({ accountId: account.id, fullName: 'Nadia Saputri', nik: null });
    expect(user.nikMasked).toBeNull();
  });

  it('updateProfile rejects an invalid NIK format', async () => {
    const { useCase, account } = await buildUseCase();
    await expect(
      useCase.updateProfile({ accountId: account.id, fullName: 'Nadia Saputri', nik: '123' })
    ).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } });
    await expect(
      useCase.updateProfile({ accountId: account.id, fullName: 'Nadia Saputri', nik: '3174055203960000' })
    ).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } });
  });

  it('getMe rejects an unknown account with 401', async () => {
    const { useCase } = await buildUseCase();
    await expect(useCase.getMe({ accountId: 'acc_nope' })).rejects.toMatchObject({
      data: { code: 'UNAUTHORIZED' }
    });
  });
});
