const { createDuplicateKeyVerifier, detectDuplicateJsonKey } = require('../duplicate-json-keys');

describe('detectDuplicateJsonKey', () => {
  it('returns null when there is no duplicate key', () => {
    expect(detectDuplicateJsonKey('{"a":1,"b":2}')).toBeNull();
    expect(detectDuplicateJsonKey('{"a":{"b":1,"c":2},"d":[1,2,3]}')).toBeNull();
    expect(detectDuplicateJsonKey('{}')).toBeNull();
    expect(detectDuplicateJsonKey('')).toBeNull();
  });

  it('returns the first duplicate key at the top level', () => {
    expect(detectDuplicateJsonKey('{"a":1,"a":2}')).toBe('a');
    expect(detectDuplicateJsonKey('{"a":1,"b":2,"a":3}')).toBe('a');
  });

  it('returns a duplicate key inside a nested object', () => {
    expect(detectDuplicateJsonKey('{"outer":{"x":1,"x":2}}')).toBe('x');
  });

  it('treats the same key in different scopes as distinct', () => {
    expect(detectDuplicateJsonKey('{"a":{"x":1},"b":{"x":2}}')).toBeNull();
    expect(detectDuplicateJsonKey('[{"x":1},{"x":2}]')).toBeNull();
  });

  it('detects a duplicate inside an object nested in an array', () => {
    expect(detectDuplicateJsonKey('[{"x":1,"x":2}]')).toBe('x');
  });

  it('ignores string values (a string is only a key when followed by a colon)', () => {
    expect(detectDuplicateJsonKey('{"a":"a","b":"a"}')).toBeNull();
    expect(detectDuplicateJsonKey('{"a":"hello: world"}')).toBeNull();
  });

  it('skips whitespace between a string and its colon', () => {
    expect(detectDuplicateJsonKey('{"a" : 1, "a" : 2}')).toBe('a');
    expect(detectDuplicateJsonKey('{\n  "a": 1,\n  "a": 2\n}')).toBe('a');
  });

  it('does not end a string early on an escaped quote', () => {
    // The value contains an escaped quote; the key "a" appears once.
    expect(detectDuplicateJsonKey('{"a":"say \\"hi\\"","b":2}')).toBeNull();
    // An escaped backslash before a quote means the quote DOES end the string.
    expect(detectDuplicateJsonKey('{"a":"x\\\\","a":2}')).toBe('a');
  });

  it('returns null for an unterminated string', () => {
    expect(detectDuplicateJsonKey('{"a":"unterminated')).toBeNull();
  });

  it('accepts a Buffer as well as a string', () => {
    expect(detectDuplicateJsonKey(Buffer.from('{"a":1,"a":2}', 'utf8'))).toBe('a');
    expect(detectDuplicateJsonKey(Buffer.from('{"a":1}', 'utf8'))).toBeNull();
  });
});

describe('createDuplicateKeyVerifier', () => {
  it('does nothing when disabled', () => {
    const verify = createDuplicateKeyVerifier(false);
    expect(() => verify({}, {}, Buffer.from('{"a":1,"a":2}', 'utf8'))).not.toThrow();
  });

  it('does nothing for an empty body', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from('', 'utf8'))).not.toThrow();
  });

  it('does nothing when there is no duplicate', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from('{"a":1,"b":2}', 'utf8'))).not.toThrow();
  });

  it('throws a 400 Boom error naming the duplicate key', () => {
    const verify = createDuplicateKeyVerifier(true);
    let caught;
    try {
      verify({}, {}, Buffer.from('{"a":1,"a":2}', 'utf8'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.output.statusCode).toBe(400);
    expect(caught.message).toContain('"a"');
  });
});
