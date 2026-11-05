const { createNikCrypto, maskNik } = require('../nik-crypto');

describe('nik-crypto', () => {
  const key = Buffer.alloc(32, 7);
  const nikCrypto = createNikCrypto({ key });

  it('encrypts and decrypts a NIK (AES-256-GCM round-trip)', () => {
    const cipher = nikCrypto.encrypt('3171010101900001');
    expect(cipher).not.toContain('3171010101900001');
    expect(nikCrypto.decrypt(cipher)).toBe('3171010101900001');
  });

  it('rejects a tampered ciphertext (auth tag)', () => {
    const cipher = nikCrypto.encrypt('3171010101900001');
    const parts = cipher.split(':');
    const tampered = `${parts[0]}:${Buffer.from('tampered').toString('base64')}:${parts[2]}`;
    expect(() => nikCrypto.decrypt(tampered)).toThrow();
  });

  it('rejects a malformed ciphertext', () => {
    expect(() => nikCrypto.decrypt('not-a-cipher')).toThrow('Malformed NIK ciphertext');
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => createNikCrypto({ key: Buffer.alloc(16, 1) })).toThrow('32-byte key');
  });

  it('masks a NIK as 4+4', () => {
    expect(maskNik('3171010101900001')).toBe('3171 •••• •••• 0001');
    expect(maskNik('not-a-nik')).toBe('•••• •••• •••• ••••');
  });
});
