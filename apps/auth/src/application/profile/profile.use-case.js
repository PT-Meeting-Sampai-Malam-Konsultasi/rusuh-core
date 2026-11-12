const { apiError } = require('@/application/shared/api-error');
const { normalizeNik, isValidNikFormat, maskNik, encryptNik, resolveEncryptionKey } = require('@/domain/nik');

/**
 * Profile use case (LLD-01 §5.1/§5.2, openapi.yaml getMe).
 * Profile = name + locale + an OPTIONAL NIK of the account holder
 * (ADR-0031 revises D17: the design's "Saya sendiri" button and the
 * "Simpan NIK ini ke profil" checkbox need the account's own NIK saved,
 * encrypted, so it auto-fills on the next purchase).
 * The NIK is stored encrypted (AES-256-GCM, same key as core-module) and
 * only the masked form is ever returned. Completing the profile sets
 * profile_complete = true.
 *
 * @param {object} deps - Use-case dependencies.
 * @param {import('@/domain/ports/store.port').AuthStore} deps.store - Repository.
 * @param {import('@/domain/ports/logger.port').Logger} deps.logger - Structured logger.
 * @param {Buffer} deps.nikEncryptionKey - 32-byte key for the profile NIK.
 * @returns {object} { getMe, updateProfile }.
 */
function createProfileUseCase({ store, logger, nikEncryptionKey }) {
  const log = logger || { info: () => {}, error: () => {} };
  // Unset in tests/direct construction = dev key (the container passes the
  // configured key in production).
  const key = nikEncryptionKey || resolveEncryptionKey();

  const toUser = (account, profile) => ({
    userId: account.id,
    email: account.email,
    fullName: profile?.name ?? null,
    locale: profile?.locale ?? 'id',
    nikMasked: profile?.nikMasked ?? null
  });

  return {
    async getMe({ accountId }) {
      const account = await store.findAccountById(accountId);
      if (!account) throw apiError('UNAUTHORIZED', 'Akun tidak ditemukan');
      const profile = await store.findProfile(accountId);
      return toUser(account, profile);
    },

    async updateProfile({ accountId, fullName, locale, nik }) {
      const account = await store.findAccountById(accountId);
      if (!account) throw apiError('UNAUTHORIZED', 'Akun tidak ditemukan');

      // NIK is optional: undefined = leave unchanged; null/'' = clear it;
      // a value = validate the format, then store it encrypted + masked.
      let nikPatch;
      if (nik !== undefined) {
        if (nik === null || nik === '') {
          nikPatch = { nikCiphertext: null, nikMasked: null };
        } else {
          const normalized = normalizeNik(nik);
          if (!isValidNikFormat(normalized)) {
            throw apiError('BAD_REQUEST', 'Format NIK tidak valid (16 digit sesuai KTP).');
          }
          nikPatch = {
            nikCiphertext: encryptNik(normalized, key),
            nikMasked: maskNik(normalized)
          };
        }
      }

      const profile = await store.upsertProfile(accountId, {
        name: fullName,
        locale,
        ...(nikPatch || {})
      });
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
