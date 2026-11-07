const Boom = require('@hapi/boom');
const { createDuplicateKeyVerifier, detectDuplicateJsonKey } = require('../duplicate-json-keys');

describe('detectDuplicateJsonKey', () => {
  it('returns null when there is no duplicate key', () => {
    expect(detectDuplicateJsonKey('{"a":1,"b":2}')).toBeNull();
    expect(detectDuplicateJsonKey('{"a":{"b":1},"c":{"b":2}}')).toBeNull();
    expect(detectDuplicateJsonKey('["a","a"]')).toBeNull();
    expect(detectDuplicateJsonKey('{"a":"b","c":"a"}')).toBeNull();
    expect(detectDuplicateJsonKey('')).toBeNull();
    expect(detectDuplicateJsonKey('{}')).toBeNull();
  });

  it('accepts a Buffer as well as a string', () => {
    expect(detectDuplicateJsonKey(Buffer.from('{"a":1,"a":2}', 'utf8'))).toBe('a');
    expect(detectDuplicateJsonKey(Buffer.from('{"a":1}', 'utf8'))).toBeNull();
  });

  it('returns the duplicate key at the top level', () => {
    expect(detectDuplicateJsonKey('{"a":1,"a":2}')).toBe('a');
    expect(detectDuplicateJsonKey('{ "a" : 1 , "a" : 2 }')).toBe('a');
  });

  it('returns the duplicate key inside a nested object', () => {
    expect(detectDuplicateJsonKey('{"a":{"b":1,"b":2}}')).toBe('b');
    expect(detectDuplicateJsonKey('[{"a":1,"a":2}]')).toBe('a');
  });

  it('returns the first duplicate when several exist', () => {
    expect(detectDuplicateJsonKey('{"a":1,"a":2,"b":3,"b":4}')).toBe('a');
  });

  it('handles keys containing a colon or an escaped quote', () => {
    expect(detectDuplicateJsonKey('{"a:b":1,"a:b":2}')).toBe('a:b');
    // The key is returned as its raw bytes (no JSON unescaping), so the
    // escaped quote stays as backslash + quote.
    expect(detectDuplicateJsonKey('{"a\\"b":1,"a\\"b":2}')).toBe('a\\"b');
  });

  it('does not treat a quote preceded by an even number of backslashes as escaped', () => {
    // The key is `a\\` (two literal backslashes); the closing quote is NOT
    // escaped because it is preceded by two backslashes. Raw bytes are
    // returned as-is.
    expect(detectDuplicateJsonKey('{"a\\\\":1,"a\\\\":2}')).toBe('a\\\\');
  });

  it('returns null for an unterminated string', () => {
    expect(detectDuplicateJsonKey('{"a":1,"b":')).toBeNull();
    expect(detectDuplicateJsonKey('{"a":1,"b')).toBeNull();
  });
});

describe('createDuplicateKeyVerifier', () => {
  it('does nothing when disabled, even with a duplicate key', () => {
    const verify = createDuplicateKeyVerifier(false);
    expect(() => verify({}, {}, Buffer.from('{"a":1,"a":2}', 'utf8'))).not.toThrow();
  });

  it('does nothing for an empty body', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.alloc(0))).not.toThrow();
  });

  it('does nothing when there is no duplicate key', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from('{"a":1,"b":2}', 'utf8'))).not.toThrow();
  });

  it('throws a Boom badRequest naming the duplicate key', () => {
    const verify = createDuplicateKeyVerifier(true);
    let caught;
    try {
      verify({}, {}, Buffer.from('{"order_id":"x","order_id":"y"}', 'utf8'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(Boom.isBoom(caught)).toBe(true);
    expect(caught.output.statusCode).toBe(400);
    expect(caught.message).toContain('Duplicate JSON key detected: "order_id"');
  });
});
