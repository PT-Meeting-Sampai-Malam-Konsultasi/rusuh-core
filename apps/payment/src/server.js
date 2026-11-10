require('./alias');
require('dotenv').config();

const http = require('http');
const defaultPlatform = require('@/platform/common');
const { loadEnvironment } = require('@/infrastructure/config/environment');
const { createApp } = require('@/app');

/**
 * Starts the HTTP server and registers controlled shutdown handlers.
 *
 * @returns {http.Server} Active HTTP server.
 */
function startServer() {
  const config = loadEnvironment();
  const app = createApp({ config });
  const server = http.createServer(app);
  let shuttingDown = false;

  /**
   * Stops accepting connections and exits after cleanup or the configured deadline.
   *
   * @param {string} signal - Process signal that initiated shutdown.
   * @returns {void}
   */
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    const logger = defaultPlatform.LoggerBuilder?.getLogger?.();
    logger?.addTags?.(['server', 'shutdown'])?.addData?.({ signal })?.info?.('Graceful shutdown started');

    const timeout = setTimeout(() => process.exit(1), config.gracefulShutdownTimeoutMs);
    timeout.unref();
    server.close(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('uncaughtException', (error) => {
    defaultPlatform.LoggerBuilder?.getLogger?.()
      .addTags?.(['server', 'uncaughtException'])
      ?.addData?.({ error: error.message })
      ?.error?.('Uncaught exception');
    shutdown('uncaughtException');
  });
  process.once('unhandledRejection', (error) => {
    defaultPlatform.LoggerBuilder?.getLogger?.()
      .addTags?.(['server', 'unhandledRejection'])
      ?.addData?.({ error: error?.message })
      ?.error?.('Unhandled rejection');
    shutdown('unhandledRejection');
  });

  server.listen(config.port, () => {
    defaultPlatform.LoggerBuilder?.getLogger?.()
      .addTags?.(['server', 'listen'])
      ?.addData?.({ port: config.port })
      ?.info?.('Server started');
  });

  return server;
}

if (require.main === module) startServer();

module.exports = { startServer };
