const platform = require('../common');

describe('platform/common', () => {
  it('LoggerBuilder.getLogger returns a chainable logger', () => {
    const logger = platform.LoggerBuilder.getLogger();
    expect(logger.addTags(['x'])).toBe(logger);
    expect(logger.addData({ a: 1 })).toBe(logger);
    expect(() => logger.info('hello')).not.toThrow();
    expect(() => logger.error('oops')).not.toThrow();
  });

  it('LoggerBuilder.getMetadataFromRequest returns an empty object', () => {
    expect(platform.LoggerBuilder.getMetadataFromRequest({})).toEqual({});
  });

  it('logRequest returns an empty object', () => {
    expect(platform.logRequest({}, { statusCode: 200 })).toEqual({});
  });

  it('unifyResponse returns undefined (the raw payload is used)', () => {
    expect(platform.unifyResponse({}, {}, { data: 1 })).toBeUndefined();
  });
});
