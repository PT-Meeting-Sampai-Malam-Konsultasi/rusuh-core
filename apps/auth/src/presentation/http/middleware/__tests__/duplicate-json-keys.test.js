const Boom = require('@hapi/boom');
const { createDuplicateKeyVerifier, detectDuplicateJsonKey } = require('../duplicate-json-keys');

describe('detectDuplicateJsonKey', () => {
  it('returns null for a clean object', () => {
    expect(detectDuplicateJsonKey('{"email":"a@b.c","code":"123456"}')).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(detectDuplicateJsonKey('')).toBeNull();
    expect(detectDuplicateJsonKey(Buffer.alloc(0))).toBeNull();
  });

  it('returns the duplicate key at the top level', () => {
    expect(detectDuplicateJsonKey('{"email":"a@b.c","email":"d@e.f"}')).toBe('email');
  });

  it('returns the duplicate key in a nested object', () => {
    expect(detectDuplicateJsonKey('{"a":{"b":1,"b":2}}')).toBe('b');
  });

  it('does not flag the same key in sibling scopes', () => {
    expect(detectDuplicateJsonKey('{"a":{"b":1},"c":{"b":2}}')).toBeNull();
  });

  it('returns the duplicate key inside an array of objects', () => {
    expect(detectDuplicateJsonKey('[{"a":1},{"a":1,"a":2}]')).toBe('a');
  });

  it('does not flag a key-like string inside an array', () => {
    expect(detectDuplicateJsonKey('{"a":["b","b"]}')).toBeNull();
  });

  it('does not flag a colon inside a string value', () => {
    expect(detectDuplicateJsonKey('{"a":"b: c","d":1}')).toBeNull();
  });

  it('handles whitespace between a key and its colon', () => {
    expect(detectDuplicateJsonKey('{ "email" : "a@b.c" , "email" : "d@e.f" }')).toBe('email');
  });

  it('handles an escaped quote inside a string value', () => {
    expect(detectDuplicateJsonKey('{"a":"x\\"y","b":1}')).toBeNull();
    expect(detectDuplicateJsonKey('{"a":"x\\"y","a":2}')).toBe('a');
  });

  it('handles an even number of backslashes before a quote (quote is not escaped)', () => {
    expect(detectDuplicateJsonKey('{"a":"x\\\\","a":2}')).toBe('a');
  });

  it('returns null for an unterminated string', () => {
    expect(detectDuplicateJsonKey('{"a":"unterminated')).toBeNull();
  });

  it('accepts a string as well as a Buffer', () => {
    expect(detectDuplicateJsonKey(Buffer.from('{"a":1,"a":2}'))).toBe('a');
  });
});

describe('createDuplicateKeyVerifier', () => {
  it('does nothing when disabled, even with duplicates', () => {
    const verify = createDuplicateKeyVerifier(false);
    expect(() => verify({}, {}, Buffer.from('{"a":1,"a":2}'))).not.toThrow();
  });

  it('does nothing for an empty body when enabled', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.alloc(0))).not.toThrow();
  });

  it('does nothing when enabled and there is no duplicate', () => {
    const verify = createDuplicateKeyVerifier(true);
    expect(() => verify({}, {}, Buffer.from('{"a":1,"b":2}'))).not.toThrow();
  });

  it('throws a Boom badRequest naming the duplicate key when enabled', () => {
    const verify = createDuplicateKeyVerifier(true);
    let caught;
    try {
      verify({}, {}, Buffer.from('{"email":"a@b.c","email":"d@e.f"}'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(Boom.isBoom(caught)).toBe(true);
    expect(caught.output.statusCode).toBe(400);
    expect(caught.message).toContain('email');
  });
});
