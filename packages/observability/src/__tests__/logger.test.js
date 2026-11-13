const { createLogger } = require('../logger');

describe('createLogger', () => {
  it('emits one JSON line per event', () => {
    const lines = [];
    const logger = createLogger({ service: 'test', write: (line) => lines.push(line) });
    logger.addTags(['server', 'listen']).addData({ port: 8081 }).info('Server started');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe('info');
    expect(parsed.service).toBe('test');
    expect(parsed.event).toBe('Server started');
    expect(parsed.tags).toEqual(['server', 'listen']);
    expect(parsed.port).toBe(8081);
  });
});
