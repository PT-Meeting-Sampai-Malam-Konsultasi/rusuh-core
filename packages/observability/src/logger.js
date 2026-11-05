/**
 * Structured JSON logger (Q40: JSON + correlation ids + masked NIK, no
 * tokens/OTP/secrets). One line per event, written to stdout.
 */
function createLogger({ service = 'rusuh-core', write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const emit = (level, message, fields = {}) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service,
      message,
      ...fields
    });
    write(line);
  };

  const logger = {
    addTags: (tags) => {
      logger._tags = [...(logger._tags || []), ...tags];
      return logger;
    },
    addData: (data) => {
      logger._data = { ...(logger._data || {}), ...data };
      return logger;
    },
    info: (message) => {
      emit('info', message, { tags: logger._tags, ...logger._data });
      logger._tags = [];
      logger._data = {};
    },
    error: (message) => {
      emit('error', message, { tags: logger._tags, ...logger._data });
      logger._tags = [];
      logger._data = {};
    }
  };
  return logger;
}

module.exports = { createLogger };
