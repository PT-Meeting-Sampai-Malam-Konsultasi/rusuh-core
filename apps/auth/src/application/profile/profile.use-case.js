const { apiError } = require('@/application/shared/api-error');

/**
 * Profile use case (LLD-01 §5.1/§5.2, openapi.yaml getMe).
 * Profile = name only (D17 corrected, 5 Nov: no NIK on the account).
 * Completing the profile sets profile_complete = true.
 *
 * @param {object} deps - Use-case dependencies.
 * @param {import('@/domain/ports/store.port').AuthStore} deps.store - Repository.
 * @param {import('@/domain/ports/logger.port').Logger} deps.logger - Structured logger.
 * @returns {object} { getMe, updateProfile }.
 */
function createProfileUseCase({ store, logger }) {
  const log = logger || { info: () => {}, error: () => {} };

  const toUser = (account, profile) => ({
    userId: account.id,
    email: account.email,
    fullName: profile?.name ?? null,
    locale: profile?.locale ?? 'id'
  });

  return {
    async getMe({ accountId }) {
      const account = await store.findAccountById(accountId);
      if (!account) throw apiError('UNAUTHORIZED', 'Akun tidak ditemukan');
      const profile = await store.findProfile(accountId);
      return toUser(account, profile);
    },

    async updateProfile({ accountId, fullName, locale }) {
      const account = await store.findAccountById(accountId);
      if (!account) throw apiError('UNAUTHORIZED', 'Akun tidak ditemukan');
      const profile = await store.upsertProfile(accountId, { name: fullName, locale });
      await store.createAuditLog({
        accountId,
        action: 'profile_completed',
        detail: { fullName: profile.name, locale: profile.locale }
      });
      log.info('profile_completed');
      return toUser(account, profile);
    }
  };
}

module.exports = { createProfileUseCase };
