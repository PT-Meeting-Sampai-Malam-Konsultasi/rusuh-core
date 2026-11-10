const { createLogger } = require('@rusuh/observability');
const { createSqsAdapter } = require('@/infrastructure/messaging/sqs');
const { createSesAdapter } = require('@/infrastructure/messaging/ses');
const { createS3Adapter } = require('@/infrastructure/messaging/s3');
const { createDbPool } = require('@/infrastructure/persistence/db');
const {
  createPostgresEmailLogStore,
  createMemoryEmailLogStore
} = require('@/infrastructure/persistence/email-log.store');
const { createEmailSender } = require('@/infrastructure/messaging/email.sender');
const { createWorkerUseCase } = require('@/application/worker/worker.use-case');

/**
 * Composition root: builds every adapter and wires the application layer
 * together. This file lives at src/ root (not in infrastructure/) because
 * it imports from every layer to wire them — the boundary rule exempts
 * src/*.js entry points for exactly this reason.
 *
 * All AWS/PG clients are injectable so tests run without live AWS.
 *
 * @param {object} options - Container dependencies.
 * @param {object} options.config - Validated runtime configuration.
 * @param {object} [options.sqs] - SQS adapter (built from config when absent).
 * @param {object} [options.ses] - SES adapter.
 * @param {object} [options.s3] - S3 adapter.
 * @param {object} [options.pool] - pg Pool (built from DATABASE_URL when absent).
 * @param {object} [options.logger] - Structured logger.
 * @returns {object} Container with the worker and its collaborators.
 */
function createContainer({ config, sqs, ses, s3, pool, logger = createLogger({ service: 'notification' }) } = {}) {
  if (!config) throw new Error('createContainer requires config');

  const log = (level, message, data) => {
    logger.addTags(['container']).addData(data)[level](message);
  };

  const sqsAdapter = sqs || createSqsAdapter({ region: config.aws.region });
  const sesAdapter = ses || createSesAdapter({ region: config.aws.region });
  const s3Adapter = s3 || createS3Adapter({ region: config.aws.region });
  const dbPool = pool !== undefined ? pool : createDbPool({ connectionString: config.databaseUrl });

  let logStore;
  if (dbPool) {
    logStore = createPostgresEmailLogStore({ pool: dbPool, staleMinutes: config.claimStaleMinutes });
  } else {
    log('info', 'DATABASE_URL is not set, using in-memory email_log (degraded, non-durable)', {});
    logStore = createMemoryEmailLogStore({ staleMinutes: config.claimStaleMinutes });
  }

  const sender = createEmailSender({
    ses: sesAdapter,
    from: config.ses.fromEmail,
    maxSendsPerSecond: config.ses.maxSendsPerSecond
  });

  const worker = createWorkerUseCase({
    config,
    sqs: sqsAdapter,
    s3: s3Adapter,
    pool: dbPool,
    logStore,
    sender,
    logger
  });

  return { config, worker, logStore, sender, logger };
}

module.exports = { createContainer };
