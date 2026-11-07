const { maskNik, hmacNik, isValidNikFormat, encryptNik, decryptNik, normalizeNik } = require('@/domain/nik');

describe('nik', () => {
  const key = Buffer.from('a'.repeat(32));

  describe('isValidNikFormat', () => {
    it('accepts the three synthetic dataset NIKs', () => {
      expect(isValidNikFormat('3171010101900001')).toBe(true);
      expect(isValidNikFormat('3171014101900002')).toBe(true);
      expect(isValidNikFormat('3271010202850003')).toBe(true);
    });
    it('accepts a female birth day (day + 40)', () => {
      expect(isValidNikFormat('3171014101900002')).toBe(true);
    });
    it('rejects non-16-digit values', () => {
      expect(isValidNikFormat('317101010190001')).toBe(false);
      expect(isValidNikFormat('31710101019000011')).toBe(false);
      expect(isValidNikFormat('31710101019000a1')).toBe(false);
      expect(isValidNikFormat('')).toBe(false);
    });
    it('rejects an impossible birth date', () => {
      expect(isValidNikFormat('3171013202900001')).toBe(false); // 32 Feb
      expect(isValidNikFormat('3171010013900001')).toBe(false); // month 13
    });
    it('rejects sequence 0000', () => {
      expect(isValidNikFormat('3171010101900000')).toBe(false);
    });
    it('rejects a female day outside 41-71', () => {
      expect(isValidNikFormat('3171017201900001')).toBe(false); // day 72
      expect(isValidNikFormat('3171014001900001')).toBe(false); // day 40 (not female, not valid male)
    });
  });

  describe('normalizeNik', () => {
    it('strips whitespace', () => {
      expect(normalizeNik(' 3171 0101 0190 0001 ')).toBe('3171010101900001');
    });
  });

  describe('maskNik', () => {
    it('shows 4+4 (D19 / Q19)', () => {
      expect(maskNik('3171010101900001')).toBe('3171 •••• •••• 0001');
    });
  });

  describe('hmacNik', () => {
    it('is deterministic and differs per NIK', () => {
      const a = hmacNik('3171010101900001', 'key');
      const b = hmacNik('3171010101900001', 'key');
      const c = hmacNik('3171014101900002', 'key');
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).toHaveLength(64);
    });
  });

  describe('encryptNik / decryptNik', () => {
    it('round-trips and is non-deterministic (random IV)', () => {
      const nik = '3171010101900001';
      const first = encryptNik(nik, key);
      const second = encryptNik(nik, key);
      expect(first).not.toBe(second);
      expect(decryptNik(first, key)).toBe(nik);
      expect(decryptNik(second, key)).toBe(nik);
    });
    it('throws on a tampered ciphertext', () => {
      const cipher = encryptNik('3171010101900001', key);
      const tampered = cipher.slice(0, -2) + (cipher.endsWith('aa') ? 'bb' : 'aa');
      expect(() => decryptNik(tampered, key)).toThrow();
    });
  });
});
