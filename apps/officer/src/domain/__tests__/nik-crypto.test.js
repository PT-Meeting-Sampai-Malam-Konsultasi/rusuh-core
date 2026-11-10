const { encryptText } = require('@rusuh/contracts').nikCrypto;
const { createNikCrypto, maskNik } = require('../nik');

describe('nik-crypto', () => {
  const key = Buffer.alloc(32, 7);
  const nikCrypto = createNikCrypto({ key });

  it('encrypts and decrypts a NIK (AES-256-GCM round-trip)', () => {
    const cipher = nikCrypto.encrypt('3171010101900001');
    expect(cipher).not.toContain('3171010101900001');
    expect(nikCrypto.decrypt(cipher)).toBe('3171010101900001');
  });

  it('decrypts a ciphertext written by core-module (shared @rusuh/contracts format)', () => {
    // core-module writes tickets.nik_ciphertext with the same shared
    // encryptText; this is the gate-scan read path.
    const stored = encryptText('3171010101900001', key);
    expect(nikCrypto.decrypt(stored)).toBe('3171010101900001');
  });

  it('rejects a tampered ciphertext (auth tag)', () => {
    const buffer = Buffer.from(nikCrypto.encrypt('3171010101900001'), 'base64url');
    buffer[buffer.length - 1] = (buffer[buffer.length - 1] + 1) % 256;
    expect(() => nikCrypto.decrypt(buffer.toString('base64url'))).toThrow();
  });

  it('rejects a malformed ciphertext', () => {
    expect(() => nikCrypto.decrypt('not-a-cipher')).toThrow('Malformed ciphertext');
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => createNikCrypto({ key: Buffer.alloc(16, 1) })).toThrow('32-byte key');
  });

  it('masks a NIK as 4+4', () => {
    expect(maskNik('3171010101900001')).toBe('3171 •••• •••• 0001');
    expect(maskNik('not-a-nik')).toBe('•••• •••• •••• ••••');
  });
});
