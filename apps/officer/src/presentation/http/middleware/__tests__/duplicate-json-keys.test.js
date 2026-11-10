const { createDuplicateKeyVerifier, detectDuplicateJsonKey } = require('../duplicate-json-keys');

describe('detectDuplicateJsonKey', () => {
  it('returns null when there is no duplicate key', () => {
    expect(detectDuplicateJsonKey(Buffer.from('{"a":1,"b":2}', 'utf8'))).toBeNull();
    expect(detectDuplicateJsonKey('{"a":1,"b":2}')).toBeNull();
    expect(detectDuplicateJsonKey('')).toBeNull();
    expect(detectDuplicateJsonKey('{}')).toBeNull();
  });

  it('returns the duplicate key for a repeated top-level key', () => {
    expect(detectDuplicateJsonKey('{"a":1,"a":2}')).toBe('a');
    expect(detectDuplicateJsonKey('{"a":1,"b":2,"a":3}')).toBe('a');
  });

  it('detects a duplicate key in a nested object scope', () => {
    expect(detectDuplicateJsonKey('{"outer":{"a":1,"a":2}}')).toBe('a');
    expect(detectDuplicateJsonKey('{"outer":{"x":1},"inner":{"y":1,"y":2}}')).toBe('y');
  });

  it('does not flag the same key in different object scopes', () => {
    expect(detectDuplicateJsonKey('{"a":{"x":1},"b":{"x":2}}')).toBeNull();
    expect(detectDuplicateJsonKey('[{"a":1},{"a":2}]')).toBeNull();
  });

  it('handles escaped quotes inside string values', () => {
    // The \" inside the value must not end the string early; the second "a" is still a duplicate.
    expect(detectDuplicateJsonKey('{"a":"x\\"y","a":2}')).toBe('a');
    expect(detectDuplicateJsonKey('{"a":"x\\"y","b":2}')).toBeNull();
  });

  it('handles an escaped backslash before a quote', () => {
    // "x\\" is a string ending in a backslash; the closing quote is real.
    expect(detectDuplicateJsonKey('{"a":"x\\\\","a":2}')).toBe('a');
  });

  it('returns null for an unterminated string', () => {
    expect(detectDuplicateJsonKey('{"a":"unterminated')).toBeNull();
  });

  it('ignores whitespace around keys and colons', () => {
    expect(detectDuplicateJsonKey('{ "a" : 1 , "a" : 2 }')).toBe('a');
    expect(detectDuplicateJsonKey('{\n\t"a": 1,\n\t"b": 2\n}')).toBeNull();
  });

  it('ignores keys inside arrays (no object scope)', () => {
    expect(detectDuplicateJsonKey('["a","a"]')).toBeNull();
  });
});

describe('createDuplicateKeyVerifier', () => {
  const verifier = createDuplicateKeyVerifier(true);
  const disabled = createDuplicateKeyVerifier(false);

  it('does nothing when disabled, even with a duplicate key', () => {
    expect(() => disabled({}, {}, Buffer.from('{"a":1,"a":2}', 'utf8'))).not.toThrow();
  });

  it('does nothing for an empty body', () => {
    expect(() => verifier({}, {}, Buffer.alloc(0))).not.toThrow();
  });

  it('does nothing when there is no duplicate key', () => {
    expect(() => verifier({}, {}, Buffer.from('{"a":1,"b":2}', 'utf8'))).not.toThrow();
  });

  it('throws a 400 Boom error on a duplicate key', () => {
    let caught;
    try {
      verifier({}, {}, Buffer.from('{"a":1,"a":2}', 'utf8'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.isBoom).toBe(true);
    expect(caught.output.statusCode).toBe(400);
    expect(caught.message).toContain('Duplicate JSON key detected: "a"');
  });
});
