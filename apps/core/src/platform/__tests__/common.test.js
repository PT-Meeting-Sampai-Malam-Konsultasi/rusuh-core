const { LoggerBuilder, logRequest, unifyResponse, preHandler } = require('../common');

describe('platform/common (local platform shim)', () => {
  it('LoggerBuilder returns a chainable logger', () => {
    const logger = LoggerBuilder.getLogger();
    expect(logger.addTags('a')).toBe(logger);
    expect(logger.addData({})).toBe(logger);
    expect(LoggerBuilder.getMetadataFromRequest()).toEqual({});
  });

  it('logRequest returns an empty metadata object', () => {
    expect(logRequest()).toEqual({});
  });

  it('unifyResponse returns undefined (the response middleware falls back to the raw payload)', () => {
    expect(unifyResponse({ data: 1 })).toBeUndefined();
    expect(unifyResponse()).toBeUndefined();
  });

  it('preHandler is a pass-through that calls next()', () => {
    const next = jest.fn();
    preHandler({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
