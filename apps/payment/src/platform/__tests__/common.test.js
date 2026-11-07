const { LoggerBuilder, logRequest, unifyResponse, preHandler } = require('../common');

describe('platform common (local shim)', () => {
  it('LoggerBuilder returns a chainable logger that writes to console', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const logger = LoggerBuilder.getLogger();
      expect(logger.addTags(['a']).addData({ x: 1 })).toBe(logger);
      logger.info('hello', { a: 1 });
      expect(info).toHaveBeenCalledWith('hello', { a: 1 });
      logger.error('boom');
      expect(error).toHaveBeenCalledWith('boom');
      expect(LoggerBuilder.getMetadataFromRequest()).toEqual({});
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
  });

  it('logRequest returns no extra metadata and unifyResponse returns undefined', () => {
    expect(logRequest()).toEqual({});
    expect(unifyResponse()).toBeUndefined();
  });

  it('preHandler passes through to next', () => {
    const next = jest.fn();
    preHandler({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
