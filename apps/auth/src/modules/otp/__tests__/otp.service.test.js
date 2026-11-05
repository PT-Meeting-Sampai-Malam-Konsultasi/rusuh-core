const { createMemoryStore } = require('@/infrastructure/store/memory-store');
const { createMemoryMailer } = require('@/infrastructure/mailer/memory-mailer');
const { createTokenService } = require('@/infrastructure/tokens/token-service');
const { createOtpService, hmacCode, generateCode, normalizeEmail } = require('../otp.service');

function buildService() {
  const store = createMemoryStore();
  const mailer = createMemoryMailer();
  const tokens = createTokenService({ logger: { info: () => {} } });
  const logger = { info: jest.fn(), error: jest.fn() };
  const service = createOtpService({ store, mailer, tokens, logger, otpSecret: 'test-secret' });
  return { service, store, mailer, tokens, logger };
}

describe('otp.service', () => {
  describe('requestOtp', () => {
    it('creates a challenge and enqueues the OTP job', async () => {
      const { service, mailer } = buildService();
      const result = await service.requestOtp({ email: '  Rina@Example.com ', consentVersion: '2026-10' });
      expect(result.challengeId).toMatch(/^ch_/);
      expect(result.resendAfterSeconds).toBe(60);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0].to).toBe('rina@example.com');
      expect(mailer.sent[0].code).toMatch(/^[0-9]{6}$/);
    });

    it('enforces the 60 s resend cooldown', async () => {
      const { service } = buildService();
      await service.requestOtp({ email: 'a@example.com' });
      await expect(service.requestOtp({ email: 'a@example.com' })).rejects.toMatchObject({
        data: { code: 'TOO_MANY_REQUESTS' }
      });
    });

    it('enforces 3 sends per email per 10 minutes', async () => {
      const { service, store } = buildService();
      // Seed 3 prior sends (older than the cooldown, within the window).
      const at = new Date(Date.now() - 61 * 1000);
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- seeding must be sequential
        const challenge = await store.createOtpChallenge({
          email: 'b@example.com',
          codeHash: 'x',
          deviceId: null,
          fullName: null,
          locale: 'id',
          expiresAt: new Date(Date.now() + 600000)
        });
        challenge.createdAt = at;
        store._otpChallenges.set(challenge.id, challenge);
      }
      await expect(service.requestOtp({ email: 'b@example.com' })).rejects.toMatchObject({
        data: { code: 'TOO_MANY_REQUESTS' }
      });
    });

    it('returns 503 and drops the challenge when the mailer fails', async () => {
      const { service, mailer, store } = buildService();
      mailer.failNext();
      await expect(service.requestOtp({ email: 'c@example.com' })).rejects.toMatchObject({
        data: { code: 'SERVICE_UNAVAILABLE' }
      });
      expect(await store.findLatestOtpChallengeByEmail('c@example.com')).toBeNull();
      // A retry is not rate-limited (the failed challenge was dropped).
      const result = await service.requestOtp({ email: 'c@example.com' });
      expect(result.challengeId).toBeTruthy();
    });
  });

  describe('verifyOtp', () => {
    it('verifies a code and creates a new account with a Session', async () => {
      const { service, mailer, store } = buildService();
      const { challengeId } = await service.requestOtp({
        email: 'd@example.com',
        fullName: 'Dewi',
        consentVersion: '2026-10'
      });
      const { code } = mailer.sent[0];
      const session = await service.verifyOtp({ challengeId, code });
      expect(session.isNewAccount).toBe(true);
      expect(session.accessToken).toBeTruthy();
      expect(session.expiresIn).toBe(900);
      expect(session.refreshToken).toMatch(/^rt_/);
      expect(session.user).toEqual(expect.objectContaining({ email: 'd@example.com', fullName: 'Dewi', locale: 'id' }));
      const account = await store.findAccountByEmail('d@example.com');
      expect(account.profileComplete).toBe(true);
    });

    it('logs in an existing account without a full name', async () => {
      const { service, mailer, store } = buildService();
      const first = await service.requestOtp({ email: 'e@example.com', fullName: 'Eko' });
      await service.verifyOtp({ challengeId: first.challengeId, code: mailer.sent[0].code });
      // Backdate the previous challenge so the 60 s cooldown has passed.
      const previous = await store.findOtpChallengeById(first.challengeId);
      previous.createdAt = new Date(Date.now() - 61 * 1000);
      store._otpChallenges.set(previous.id, previous);
      const second = await service.requestOtp({ email: 'e@example.com' });
      const session = await service.verifyOtp({ challengeId: second.challengeId, code: mailer.sent[1].code });
      expect(session.isNewAccount).toBe(false);
    });

    it('rejects a wrong code with attemptsLeft, then locks after 5 attempts', async () => {
      const { service, mailer } = buildService();
      const { challengeId } = await service.requestOtp({ email: 'f@example.com' });
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop -- attempts must be sequential
        await expect(service.verifyOtp({ challengeId, code: '000000' })).rejects.toMatchObject({
          data: { code: 'WRONG_CODE', attemptsLeft: 5 - attempt }
        });
      }
      await expect(service.verifyOtp({ challengeId, code: '000000' })).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LOCKED' }
      });
      // The real code no longer works once locked.
      await expect(service.verifyOtp({ challengeId, code: mailer.sent[0].code })).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LOCKED' }
      });
    });

    it('rejects an expired challenge and a reused code', async () => {
      const { service, mailer, store } = buildService();
      const { challengeId } = await service.requestOtp({ email: 'g@example.com' });
      const { code } = mailer.sent[0];
      await store.updateOtpChallenge(challengeId, { expiresAt: new Date(Date.now() - 1000) });
      await expect(service.verifyOtp({ challengeId, code })).rejects.toMatchObject({
        data: { code: 'CHALLENGE_EXPIRED' }
      });

      const second = await service.requestOtp({ email: 'h@example.com' });
      const { code: code2 } = mailer.sent[1];
      await service.verifyOtp({ challengeId: second.challengeId, code: code2 });
      await expect(service.verifyOtp({ challengeId: second.challengeId, code: code2 })).rejects.toMatchObject({
        data: { code: 'CHALLENGE_EXPIRED' }
      });
    });

    it('rejects a code from a different device (device-bound)', async () => {
      const { service, mailer } = buildService();
      const { challengeId } = await service.requestOtp({ email: 'i@example.com', deviceId: 'w_aaaaaaaaaaaaaaaa' });
      const { code } = mailer.sent[0];
      await expect(service.verifyOtp({ challengeId, code, deviceId: 'w_bbbbbbbbbbbbbbbb' })).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' }
      });
      const session = await service.verifyOtp({ challengeId, code, deviceId: 'w_aaaaaaaaaaaaaaaa' });
      expect(session.accessToken).toBeTruthy();
    });

    it('accepts {email, code} (LLD-01 alias) and resolves the latest challenge', async () => {
      const { service, mailer } = buildService();
      await service.requestOtp({ email: 'j@example.com' });
      const session = await service.verifyOtp({ email: 'j@example.com', code: mailer.sent[0].code });
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
  });
});
