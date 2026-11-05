const { createMemoryStore } = require('@/infrastructure/store/memory-store');
const { createProfileService } = require('../profile.service');

async function buildService() {
  const store = createMemoryStore();
  const logger = { info: jest.fn(), error: jest.fn() };
  const service = createProfileService({ store, logger });
  const account = await store.createAccount({ email: 'a@example.com' });
  return { service, store, logger, account };
}

describe('profile.service', () => {
  it('getMe returns the user with a null fullName before completion', async () => {
    const { service, account } = await buildService();
    const user = await service.getMe({ accountId: account.id });
    expect(user).toEqual({ userId: account.id, email: 'a@example.com', fullName: null, locale: 'id' });
  });

  it('updateProfile sets the name, marks the profile complete, and audits it', async () => {
    const { service, store, logger, account } = await buildService();
    const user = await service.updateProfile({ accountId: account.id, fullName: 'Rina Wulandari', locale: 'id' });
    expect(user.fullName).toBe('Rina Wulandari');
    const updated = await store.findAccountById(account.id);
    expect(updated.profileComplete).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('profile_completed');
    expect(store._auditLog).toHaveLength(1);
    expect(store._auditLog[0].action).toBe('profile_completed');
  });

  it('getMe rejects an unknown account with 401', async () => {
    const { service } = await buildService();
    await expect(service.getMe({ accountId: 'acc_nope' })).rejects.toMatchObject({
      data: { code: 'UNAUTHORIZED' }
    });
  });
});
