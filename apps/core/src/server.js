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
 * URLs are configured, in-memory otherwise), then starts the sweeper and
 * the admission consumer.
 *
 * @returns {Promise<http.Server>} Active HTTP server.
 */
async function startServer() {
  const config = loadEnvironment();
  const deps = await createDeps(config);
  const app = createApp({ config, deps });
  const server = http.createServer(app);
  let shuttingDown = false;

  // Background workers (D9 sweeper + admission consumer, ADR-0023).
  deps.sweeper.start();
  const consumerStarted = deps.admissionConsumer.start();
  if (!consumerStarted && config.nodeEnv !== 'test') {
    console.warn('[core] admission consumer not started (no SQS admission queue configured).');
  }

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
    deps.admissionConsumer.stop();
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
