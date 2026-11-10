const { encryptText, decryptText, maskNik } = require('../crypto');

describe('nikCrypto', () => {
  const key = Buffer.alloc(32, 7);
  const nik = '3171010101900001';

  it('round-trips text through the canonical base64url(iv + tag + ciphertext) format', () => {
    const cipher = encryptText(nik, key);
    expect(cipher).not.toContain(nik);
    expect(cipher).not.toContain(':');
    // base64url alphabet only (no +/ or = padding).
    expect(cipher).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decryptText(cipher, key)).toBe(nik);
  });

  it('does not decrypt with a different key (auth tag failure)', () => {
    const cipher = encryptText(nik, key);
    expect(() => decryptText(cipher, Buffer.alloc(32, 9))).toThrow();
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const cipher = encryptText(nik, key);
    const buffer = Buffer.from(cipher, 'base64url');
    buffer[buffer.length - 1] = (buffer[buffer.length - 1] + 1) % 256;
    expect(() => decryptText(buffer.toString('base64url'), key)).toThrow();
  });

  it('rejects a malformed ciphertext (shorter than iv + tag)', () => {
    expect(() => decryptText('not-a-cipher', key)).toThrow('Malformed ciphertext');
    expect(() => decryptText(Buffer.alloc(20).toString('base64url'), key)).toThrow('Malformed ciphertext');
  });

  it('masks a NIK as 4+4 and tolerates whitespace', () => {
    expect(maskNik(nik)).toBe('3171 •••• •••• 0001');
    expect(maskNik('3171 0101 0190 0001')).toBe('3171 •••• •••• 0001');
    expect(maskNik('not-a-nik')).toBe('•••• •••• •••• ••••');
  });
});
