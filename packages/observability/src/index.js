const { createLogger } = require('./logger');
const { correlationMiddleware } = require('./correlation');

module.exports = { createLogger, correlationMiddleware };
