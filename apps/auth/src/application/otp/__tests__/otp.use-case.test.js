const { createMemoryStore } = require('@/infrastructure/persistence/memory-store');
const { createMemoryMailer } = require('@/infrastructure/messaging/memory-mailer');
const { createTokenService } = require('@/infrastructure/tokens/token-service');
const {
  hmacCode,
  generateCode,
  normalizeEmail,
  spaceOtpCode,
  formatOtpExpiry,
  formatOtpValidity
} = require('@/domain/otp');
const { createOtpUseCase } = require('../otp.use-case');

function buildUseCase() {
  const store = createMemoryStore();
  const mailer = createMemoryMailer();
  const tokens = createTokenService({ logger: { info: () => {} } });
  const logger = { info: jest.fn(), error: jest.fn() };
  const useCase = createOtpUseCase({ store, mailer, tokens, logger, otpSecret: 'test-secret' });
  return { useCase, store, mailer, tokens, logger };
}

describe('otp.use-case', () => {
  describe('requestOtp', () => {
    it('creates a challenge and enqueues the OTP job', async () => {
      const { useCase, mailer } = buildUseCase();
      const result = await useCase.requestOtp({ email: '  Rina@Example.com ', consentVersion: '2026-10' });
      expect(result.challengeId).toMatch(/^ch_/);
      expect(result.resendAfterSeconds).toBe(60);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0].to).toBe('rina@example.com');
      expect(mailer.sent[0].code).toMatch(/^[0-9]{6}$/);
      expect(mailer.sent[0].validFor).toBe('10 menit');
    });

    it('honours a configured OTP TTL (OTP_TTL_MS env)', async () => {
      const store = createMemoryStore();
      const mailer = createMemoryMailer();
      const tokens = createTokenService({ logger: { info: () => {} } });
      const logger = { info: jest.fn(), error: jest.fn() };
      const useCase = createOtpUseCase({ store, mailer, tokens, logger, otpSecret: 'test-secret', otpTtlMs: 300000 });
      const before = Date.now();
      const result = await useCase.requestOtp({ email: 'ttl@example.com' });
      const expiresInMs = new Date(result.expiresAt).getTime() - before;
      expect(expiresInMs).toBeGreaterThan(240000);
      expect(expiresInMs).toBeLessThanOrEqual(300000);
      // The e-mail copy follows the configured TTL, not the old hardcoded 10 min.
      expect(mailer.sent[0].validFor).toBe('5 menit');
    });

    it('enforces the 60 s resend cooldown', async () => {
      const { useCase } = buildUseCase();
      await useCase.requestOtp({ email: 'a@example.com' });
      await expect(useCase.requestOtp({ email: 'a@example.com' })).rejects.toMatchObject({
        data: { code: 'TOO_MANY_REQUESTS' }
      });
    });

    it('enforces 3 sends per email per 10 minutes', async () => {
      const { useCase, store } = buildUseCase();
      // Seed 3 prior sends (older than the cooldown, within the window).
      const at = new Date(Date.now() - 61 * 1000);
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- seeding must be sequential
        const challenge = await store.createOtpChallenge({
          email: 'b@example.com',
          codeHash: 'x',
          deviceId: null,
          locale: 'id',
          expiresAt: new Date(Date.now() + 600000)
        });
        challenge.createdAt = at;
        store._otpChallenges.set(challenge.id, challenge);
      }
      await expect(useCase.requestOtp({ email: 'b@example.com' })).rejects.toMatchObject({
        data: { code: 'TOO_MANY_REQUESTS' }
      });
    });

    it('returns 503 and drops the challenge when the mailer fails', async () => {
      const { useCase, mailer, store } = buildUseCase();
      mailer.failNext();
      await expect(useCase.requestOtp({ email: 'c@example.com' })).rejects.toMatchObject({
        data: { code: 'SERVICE_UNAVAILABLE' }
      });
      expect(await store.findLatestOtpChallengeByEmail('c@example.com')).toBeNull();
      // A retry is not rate-limited (the failed challenge was dropped).
      const result = await useCase.requestOtp({ email: 'c@example.com' });
      expect(result.challengeId).toBeTruthy();
    });
  });

  describe('verifyOtp', () => {
    it('verifies a code and creates a new account without a profile name', async () => {
      const { useCase, mailer, store } = buildUseCase();
      const { challengeId } = await useCase.requestOtp({ email: 'd@example.com', consentVersion: '2026-10' });
      const { code } = mailer.sent[0];
      const session = await useCase.verifyOtp({ challengeId, code });
      expect(session.isNewAccount).toBe(true);
      expect(session.accessToken).toBeTruthy();
      expect(session.expiresIn).toBe(900);
      expect(session.refreshToken).toMatch(/^rt_/);
      expect(session.user).toEqual(expect.objectContaining({ email: 'd@example.com', fullName: null, locale: 'id' }));
      const account = await store.findAccountByEmail('d@example.com');
      expect(account.profileComplete).toBe(false);
      expect(await store.findProfile(account.id)).toBeNull();
    });

    it('logs in an existing account and keeps its profile', async () => {
      const { useCase, mailer, store } = buildUseCase();
      const first = await useCase.requestOtp({ email: 'e@example.com' });
      const firstSession = await useCase.verifyOtp({ challengeId: first.challengeId, code: mailer.sent[0].code });
      await store.upsertProfile(firstSession.user.userId, { name: 'Eko', locale: 'id' });
      // Backdate the previous challenge so the 60 s cooldown has passed.
      const previous = await store.findOtpChallengeById(first.challengeId);
      previous.createdAt = new Date(Date.now() - 61 * 1000);
      store._otpChallenges.set(previous.id, previous);
      const second = await useCase.requestOtp({ email: 'e@example.com' });
      const session = await useCase.verifyOtp({ challengeId: second.challengeId, code: mailer.sent[1].code });
      expect(session.isNewAccount).toBe(false);
      expect(session.user.fullName).toBe('Eko');
    });

    it('rejects a wrong code with attemptsLeft, then locks after 5 attempts', async () => {
      const { useCase, mailer } = buildUseCase();
      const { challengeId } = await useCase.requestOtp({ email: 'f@example.com' });
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop -- attempts must be sequential
        await expect(useCase.verifyOtp({ challengeId, code: '000000' })).rejects.toMatchObject({
          data: { code: 'WRONG_CODE', attemptsLeft: 5 - attempt }
        });
      }
      await expect(useCase.verifyOtp({ challengeId, code: '000000' })).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LOCKED' }
      });
      // The real code no longer works once locked.
      await expect(useCase.verifyOtp({ challengeId, code: mailer.sent[0].code })).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LOCKED' }
      });
    });

    it('rejects an expired challenge and a reused code', async () => {
      const { useCase, mailer, store } = buildUseCase();
      const { challengeId } = await useCase.requestOtp({ email: 'g@example.com' });
      const { code } = mailer.sent[0];
      await store.updateOtpChallenge(challengeId, { expiresAt: new Date(Date.now() - 1000) });
      await expect(useCase.verifyOtp({ challengeId, code })).rejects.toMatchObject({
        data: { code: 'CHALLENGE_EXPIRED' }
      });

      const second = await useCase.requestOtp({ email: 'h@example.com' });
      const { code: code2 } = mailer.sent[1];
      await useCase.verifyOtp({ challengeId: second.challengeId, code: code2 });
      await expect(useCase.verifyOtp({ challengeId: second.challengeId, code: code2 })).rejects.toMatchObject({
        data: { code: 'CHALLENGE_EXPIRED' }
      });
    });

    it('rejects a code from a different device (device-bound)', async () => {
      const { useCase, mailer } = buildUseCase();
      const { challengeId } = await useCase.requestOtp({ email: 'i@example.com', deviceId: 'w_aaaaaaaaaaaaaaaa' });
      const { code } = mailer.sent[0];
      await expect(useCase.verifyOtp({ challengeId, code, deviceId: 'w_bbbbbbbbbbbbbbbb' })).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' }
      });
      const session = await useCase.verifyOtp({ challengeId, code, deviceId: 'w_aaaaaaaaaaaaaaaa' });
      expect(session.accessToken).toBeTruthy();
    });

    it('accepts {email, code} (LLD-01 alias) and resolves the latest challenge', async () => {
      const { useCase, mailer } = buildUseCase();
      await useCase.requestOtp({ email: 'j@example.com' });
      const session = await useCase.verifyOtp({ email: 'j@example.com', code: mailer.sent[0].code });
      expect(session.isNewAccount).toBe(true);
    });
  });

  describe('helpers', () => {
    it('hmacCode is deterministic and normalizeEmail lowercases + trims', () => {
      expect(hmacCode('123456', 's')).toBe(hmacCode('123456', 's'));
      expect(hmacCode('123456', 's')).not.toBe(hmacCode('123456', 'other'));
      expect(normalizeEmail('  Foo@Bar.ID ')).toBe('foo@bar.id');
      expect(generateCode()).toMatch(/^[0-9]{6}$/);
    });

    it('spaceOtpCode joins the halves with a non-breaking space', () => {
      expect(spaceOtpCode('482019')).toBe(`482${String.fromCharCode(160)}019`);
    });

    it('formatOtpValidity renders the TTL phrase per locale', () => {
      expect(formatOtpValidity(600000, 'id')).toBe('10 menit');
      expect(formatOtpValidity(300000, 'id')).toBe('5 menit');
      expect(formatOtpValidity(600000, 'en')).toBe('10 minutes');
      expect(formatOtpValidity(60000, 'en')).toBe('1 minute');
    });

    it('formatOtpExpiry renders WIB clock times per locale', () => {
      const at = new Date('2026-11-10T16:30:00Z');
      expect(formatOtpExpiry(at, 'id')).toBe('23.30 WIB');
      expect(formatOtpExpiry(at, 'en')).toBe('11.30 pm WIB');
    });
  });
});
