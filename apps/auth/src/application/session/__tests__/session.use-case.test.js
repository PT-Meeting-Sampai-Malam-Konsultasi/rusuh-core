const { createMemoryStore } = require('@/infrastructure/persistence/memory-store');
const { createMemoryDenylist } = require('@/infrastructure/cache/memory-denylist');
const { createTokenService, hashRefreshToken } = require('@/infrastructure/tokens/token-service');
const { issueSession } = require('@/application/shared/issue-session');
const { createSessionUseCase } = require('../session.use-case');

async function buildSession() {
  const store = createMemoryStore();
  const denylist = createMemoryDenylist();
  const tokens = createTokenService({ logger: { info: () => {} } });
  const logger = { info: jest.fn(), error: jest.fn() };
  const useCase = createSessionUseCase({ store, denylist, tokens, logger });
  const account = await store.createAccount({ email: 'a@example.com' });
  const session = await issueSession({ store, tokens, account, profile: null });
  return { useCase, store, denylist, tokens, logger, account, session };
}

describe('session.use-case', () => {
  describe('refresh', () => {
    it('rotates the refresh token and keeps the family expiry', async () => {
      const { useCase, store, session } = await buildSession();
      const rotated = await useCase.refresh({ refreshToken: session.refreshToken });
      expect(rotated.accessToken).not.toBe(session.accessToken);
      expect(rotated.refreshToken).not.toBe(session.refreshToken);
      expect(rotated.user.userId).toBe(session.user.userId);
      // The old token is revoked; the family expiry is unchanged.
      const oldRow = await store.findRefreshTokenByHash(hashRefreshToken(session.refreshToken));
      expect(oldRow.revokedAt).not.toBeNull();
      expect(oldRow.revokedReason).toBe('rotated');
      const newRow = await store.findRefreshTokenByHash(hashRefreshToken(rotated.refreshToken));
      expect(newRow.expiresAt.getTime()).toBe(oldRow.expiresAt.getTime());
    });

    it('rejects an unknown refresh token with 401', async () => {
      const { useCase } = await buildSession();
      await expect(useCase.refresh({ refreshToken: 'rt_nope' })).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' }
      });
    });

    it('detects reuse: a rotated token presented again revokes the whole family', async () => {
      const { useCase, store, denylist, logger, session } = await buildSession();
      const rotated = await useCase.refresh({ refreshToken: session.refreshToken });
      // Present the old (rotated) token again: reuse.
      await expect(useCase.refresh({ refreshToken: session.refreshToken })).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' }
      });
      expect(logger.error).toHaveBeenCalledWith('refresh_reuse_detected');
      // The rotated token is dead too (family revoked).
      await expect(useCase.refresh({ refreshToken: rotated.refreshToken })).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' }
      });
      // The current access jti was denylisted.
      const oldRow = await store.findRefreshTokenByHash(hashRefreshToken(session.refreshToken));
      expect(await denylist.isDenied(oldRow.currentAccessJti)).toBe(true);
    });

    it('rejects a refresh after the 7-day family expiry', async () => {
      const { useCase, store, session } = await buildSession();
      const row = await store.findRefreshTokenByHash(hashRefreshToken(session.refreshToken));
      await store.updateRefreshToken(row.id, { expiresAt: new Date(Date.now() - 1000) });
      await expect(useCase.refresh({ refreshToken: session.refreshToken })).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' }
      });
    });
  });

  describe('logout', () => {
    it('revokes the family and denylists the access jti', async () => {
      const { useCase, store, denylist, tokens, session } = await buildSession();
      const payload = await tokens.verifyAccessToken(session.accessToken, async () => false);
      await useCase.logout({ accessJti: payload.jti, accessExp: payload.exp });
      expect(await denylist.isDenied(payload.jti)).toBe(true);
      const row = await store.findRefreshTokenByHash(hashRefreshToken(session.refreshToken));
      expect(row.revokedAt).not.toBeNull();
      expect(row.revokedReason).toBe('logout');
      // The refresh token no longer works.
      await expect(useCase.refresh({ refreshToken: session.refreshToken })).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' }
      });
    });
  });
});
