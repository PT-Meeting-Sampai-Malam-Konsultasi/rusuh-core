const { LoggerBuilder, logRequest, unifyResponse } = require('../common');

describe('platform/common', () => {
  it('LoggerBuilder returns a chainable console logger', () => {
    const logger = LoggerBuilder.getLogger();
    expect(logger.addTags('a')).toBe(logger);
    expect(logger.addData({})).toBe(logger);
    expect(() => logger.info('hello')).not.toThrow();
    expect(() => logger.error('oops')).not.toThrow();
    expect(LoggerBuilder.getMetadataFromRequest({})).toEqual({});
  });

  it('logRequest returns no extra metadata', () => {
    expect(logRequest()).toEqual({});
  });

  it('unifyResponse returns undefined (the middleware falls back to the raw payload)', () => {
    expect(unifyResponse()).toBeUndefined();
  });
});
