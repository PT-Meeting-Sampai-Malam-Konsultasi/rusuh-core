const platform = require('../common');

describe('platform/common', () => {
  it('LoggerBuilder returns a chainable logger that writes to the console', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const logger = platform.LoggerBuilder.getLogger();
      expect(logger.addTags(['x'])).toBe(logger);
      expect(logger.addData({ a: 1 })).toBe(logger);
      logger.info('hello');
      logger.error('boom');
      expect(infoSpy).toHaveBeenCalledWith('hello');
      expect(errorSpy).toHaveBeenCalledWith('boom');
      expect(platform.LoggerBuilder.getMetadataFromRequest({})).toEqual({});
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('logRequest returns no metadata and unifyResponse returns undefined', () => {
    expect(platform.logRequest({})).toEqual({});
    expect(platform.unifyResponse({}, {}, {})).toBeUndefined();
  });
});
