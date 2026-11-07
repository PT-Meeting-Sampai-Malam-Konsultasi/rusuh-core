const { createTokenService, hashRefreshToken } = require('../tokens/token-service');
const { createMemoryDenylist } = require('../valkey/memory-denylist');
const { createMemoryMailer } = require('../mailer/memory-mailer');

describe('token-service', () => {
  it('signs and verifies an access token (15 min, no event claim)', async () => {
    const tokens = createTokenService({ logger: { info: () => {} } });
    const { token, jti, exp } = tokens.signAccessToken('acc_1', 'fam_1');
    const payload = await tokens.verifyAccessToken(token, async () => false);
    expect(payload.sub).toBe('acc_1');
    expect(payload.jti).toBe(jti);
    expect(payload.exp).toBe(exp);
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload.evt).toBeUndefined();
    expect(payload.event_id).toBeUndefined();
  });

  it('rejects a token verified against a different key', async () => {
    const a = createTokenService({ logger: { info: () => {} } });
    const b = createTokenService({ logger: { info: () => {} } });
    const { token } = a.signAccessToken('acc_1', 'fam_1');
    await expect(b.verifyAccessToken(token, async () => false)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a denylisted jti', async () => {
    const tokens = createTokenService({ logger: { info: () => {} } });
    const { token, jti } = tokens.signAccessToken('acc_1', 'fam_1');
    const denylist = createMemoryDenylist();
    await denylist.deny(jti, 900);
    await expect(tokens.verifyAccessToken(token, (id) => denylist.isDenied(id))).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    });
  });

  it('creates opaque refresh tokens whose hash is stable', () => {
    const tokens = createTokenService({ logger: { info: () => {} } });
    const { token, tokenHash } = tokens.createRefreshToken();
    expect(token).toMatch(/^rt_/);
    expect(tokenHash).toBe(hashRefreshToken(token));
    expect(tokens.refreshFamilyExpiresAt(new Date('2026-11-06T00:00:00Z')).toISOString()).toBe(
      '2026-11-13T00:00:00.000Z'
    );
  });
});

describe('memory-denylist', () => {
  it('denies until the TTL passes', async () => {
    const denylist = createMemoryDenylist();
    expect(await denylist.isDenied('jti-1')).toBe(false);
    await denylist.deny('jti-1', 60);
    expect(await denylist.isDenied('jti-1')).toBe(true);
    await denylist.deny('jti-2', 0);
    expect(await denylist.isDenied('jti-2')).toBe(false);
  });
});

describe('memory-mailer', () => {
  it('records OTP jobs and can simulate a failure', async () => {
    const mailer = createMemoryMailer();
    await mailer.sendOtp({ to: 'a@example.com', code: '123456', locale: 'id' });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toEqual(expect.objectContaining({ to: 'a@example.com', template: 'otp' }));
    mailer.failNext();
    await expect(mailer.sendOtp({ to: 'b@example.com', code: '654321' })).rejects.toThrow('Mailer unavailable');
  });
});
