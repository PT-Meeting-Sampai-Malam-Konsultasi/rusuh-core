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
    expect(user).toEqual({ userId: account.id, email: 'a@example.com', fullName: null, locale: 'id' });
  });

  it('updateProfile sets the name, marks the profile complete, and audits it', async () => {
    const { useCase, store, logger, account } = await buildUseCase();
    const user = await useCase.updateProfile({ accountId: account.id, fullName: 'Rina Wulandari', locale: 'id' });
    expect(user.fullName).toBe('Rina Wulandari');
    const updated = await store.findAccountById(account.id);
    expect(updated.profileComplete).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('profile_completed');
    expect(store._auditLog).toHaveLength(1);
    expect(store._auditLog[0].action).toBe('profile_completed');
  });

  it('getMe rejects an unknown account with 401', async () => {
    const { useCase } = await buildUseCase();
    await expect(useCase.getMe({ accountId: 'acc_nope' })).rejects.toMatchObject({
      data: { code: 'UNAUTHORIZED' }
    });
  });
});
