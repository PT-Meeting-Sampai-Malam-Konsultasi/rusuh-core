const { createDuplicateKeyVerifier, detectDuplicateJsonKey } = require('../duplicate-json-keys');

describe('detectDuplicateJsonKey', () => {
  it('returns null when there is no duplicate key', () => {
    expect(detectDuplicateJsonKey('{"a": 1, "b": 2}')).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(detectDuplicateJsonKey('')).toBeNull();
    expect(detectDuplicateJsonKey(Buffer.alloc(0))).toBeNull();
  });

  it('accepts a Buffer as well as a string', () => {
    expect(detectDuplicateJsonKey(Buffer.from('{"a": 1, "a": 2}', 'utf8'))).toBe('a');
  });

  it('returns the duplicate key at the top level', () => {
    expect(detectDuplicateJsonKey('{"a": 1, "a": 2}')).toBe('a');
  });

  it('returns the duplicate key inside a nested object', () => {
    expect(detectDuplicateJsonKey('{"outer": {"x": 1, "x": 2}}')).toBe('x');
  });

  it('returns null when the same key appears in sibling objects (different scopes)', () => {
    expect(detectDuplicateJsonKey('{"one": {"a": 1}, "two": {"a": 2}}')).toBeNull();
  });

  it('returns the duplicate key inside an array of objects', () => {
    expect(detectDuplicateJsonKey('[{"a": 1, "a": 2}]')).toBe('a');
  });

  it('returns null when the same key appears in separate objects of an array', () => {
    expect(detectDuplicateJsonKey('[{"a": 1}, {"a": 2}]')).toBeNull();
  });

  it('does not treat a string value as a key', () => {
    expect(detectDuplicateJsonKey('{"a": "b", "c": "a"}')).toBeNull();
  });

  it('detects a duplicate when whitespace sits between the key and the colon', () => {
    expect(detectDuplicateJsonKey('{\n  "a"\t: 1,\n  "a" : 2\n}')).toBe('a');
  });

  it('handles an escaped quote inside a key (the raw key keeps its escape)', () => {
    expect(detectDuplicateJsonKey('{"a\\"b": 1, "a\\"b": 2}')).toBe('a\\"b');
  });

  it('handles a backslash before the closing quote (even count = not escaped)', () => {
    expect(detectDuplicateJsonKey('{"a\\\\": 1, "a\\\\": 2}')).toBe('a\\\\');
  });

  it('returns null for an unterminated string', () => {
    expect(detectDuplicateJsonKey('{"a": "unterminated')).toBeNull();
  });

  it('returns null for a top-level array with no object scope', () => {
    expect(detectDuplicateJsonKey('[1, 2, "a", "a"]')).toBeNull();
  });
});

describe('createDuplicateKeyVerifier', () => {
  it('does nothing when disabled, even with a duplicate key', () => {
    const verify = createDuplicateKeyVerifier(false);
    expect(() => verify({}, {}, Buffer.from('{"a": 1, "a": 2}', 'utf8'))).not.toThrow();
  });

  it('does nothing for an empty body when enabled', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.alloc(0))).not.toThrow();
  });

  it('does nothing when enabled and there is no duplicate key', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from('{"a": 1, "b": 2}', 'utf8'))).not.toThrow();
  });

  it('throws a Boom badRequest naming the duplicate key', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from('{"a": 1, "a": 2}', 'utf8'))).toThrow('Duplicate JSON key detected: "a"');
  });
});
