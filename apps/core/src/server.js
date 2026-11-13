require('./alias');
require('dotenv').config();

const http = require('http');
const defaultPlatform = require('@/platform/common');
const { loadEnvironment } = require('@/infrastructure/config/environment');
const { createApp } = require('@/app');
const { createDeps } = require('@/container');

/**
 * Starts the HTTP server and registers controlled shutdown handlers.
 * Builds the dependency graph first (real Postgres/Valkey/SQS when their
 * URLs are configured, in-memory otherwise), then starts the sweeper.
 *
 * @returns {Promise<http.Server>} Active HTTP server.
 */
async function startServer() {
  const config = loadEnvironment();
  const deps = await createDeps(config);
  // Declared before createApp so /readyz can read it: once shutdown starts
  // (SIGTERM), /readyz answers 503 so the ALB stops sending new requests.
  let shuttingDown = false;
  const app = createApp({ config, deps, isShuttingDown: () => shuttingDown });
  const server = http.createServer(app);

  // Background worker (D9 sweeper).
  deps.sweeper.start();
  deps.queueFeedWorker.start();

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

    deps.sweeper.stop();
    deps.queueFeedWorker.stop();
    Promise.all([deps.store.close(), deps.stock.close()]).catch(() => {});

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

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[core] failed to start:', error.message);
    process.exit(1);
  });
}

module.exports = { startServer };
