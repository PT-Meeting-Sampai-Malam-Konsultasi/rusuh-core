require('./alias');
require('dotenv').config();

const http = require('http');
const defaultPlatform = require('@/platform/common');
const { loadEnvironment } = require('@/infrastructure/config/environment');
const { createApp } = require('@/app');
const { createContainer } = require('@/container');

/**
 * Starts the HTTP server (health endpoints only — this module has no public
 * API) and the SQS worker (background consumer loop) alongside it.
 *
 * @returns {http.Server} Active HTTP server.
 */
function startServer() {
  const config = loadEnvironment();
  const { worker } = createContainer({ config });
  const app = createApp({ config, isReady: () => worker.isHealthy() });
  const server = http.createServer(app);
  let shuttingDown = false;

  /**
   * Stops the worker (finishes in-flight messages) and the HTTP server,
   * then exits after cleanup or the configured deadline.
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
    worker
      .stop(config.gracefulShutdownTimeoutMs)
      .catch(() => {})
      .finally(() => {
        server.close(() => {
          clearTimeout(timeout);
          process.exit(0);
        });
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
    worker.start().catch((error) => {
      defaultPlatform.LoggerBuilder?.getLogger?.()
        .addTags?.(['worker', 'start'])
        ?.addData?.({ error: error.message })
        ?.error?.('Worker failed to start (health endpoints still serve)');
    });
  });

  return server;
}

if (require.main === module) startServer();

module.exports = { startServer };
