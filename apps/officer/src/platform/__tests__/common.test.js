const { LoggerBuilder, logRequest, unifyResponse, preHandler } = require('../common');

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

  it('preHandler passes through to next', () => {
    const next = jest.fn();
    preHandler({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
