const { apiError } = require('@/application/shared/api-error');

/**
 * Internal account lookups for sibling services (service-key protected
 * routes, never public). core-module uses this to resolve the buyer's
 * e-mail + locale when it publishes an e-mail job to notification-module
 * (LLD-04 §3: `to` is ALWAYS the account e-mail, D17; notification-module
 * itself never calls other modules). Returns the minimum the e-mail
 * templates need — no NIK, no credentials, no counters.
 *
 * @param {object} deps
 * @param {import('@/domain/ports/store.port').Store} deps.store - Account store.
 * @returns {object} Internal use cases.
 */
function createInternalUseCase({ store }) {
  return {
    /**
     * Returns the public projection of one account.
     *
     * @param {object} input
     * @param {string} input.accountId - Account id (token sub).
     * @returns {Promise<{id: string, email: string, role: string, locale: string, fullName: string|null}>}
     * @throws {Error} NOT_FOUND when the account does not exist.
     */
    async getAccount({ accountId }) {
      const account = await store.findAccountById(accountId);
      if (!account) throw apiError('NOT_FOUND', 'Akun tidak ditemukan');
      // Name + locale live on the profile (set via PUT /v1/auth/profile),
      // not on the account row.
      const profile = (await store.findProfile(accountId)) || {};
      return {
        id: account.id,
        email: account.email,
        role: account.role || 'user',
        locale: profile.locale || account.locale || 'id',
        fullName: profile.name ?? account.fullName ?? null
      };
    }
  };
}

module.exports = { createInternalUseCase };
