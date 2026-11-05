const { createLogger } = require('@rusuh/observability');
const { createSqsAdapter } = require('@/infrastructure/sqs');
const { createSesAdapter } = require('@/infrastructure/ses');
const { createS3Adapter } = require('@/infrastructure/s3');
const { createDbPool } = require('@/infrastructure/db');
const { createPostgresEmailLogStore, createMemoryEmailLogStore } = require('@/modules/email/email.log');
const { createEmailSender } = require('@/modules/email/email.sender');
const { createEmailProcessor } = require('@/modules/email/email.processor');
const { createConsumer } = require('@/modules/consumer/consumer');

/**
 * Creates the notification worker: one SQS consumer per configured queue
 * (otp + email, LLD-04 §2), sharing one email processor. The worker is the
 * only thing that sends email in the whole system (auth/core never call
 * SES directly).
 *
 * All AWS/PG clients are injectable so tests run without live AWS.
 *
 * @param {object} options - Worker dependencies.
 * @param {object} options.config - Validated runtime configuration.
 * @param {object} [options.sqs] - SQS adapter (built from config when absent).
 * @param {object} [options.ses] - SES adapter.
 * @param {object} [options.s3] - S3 adapter.
 * @param {object} [options.pool] - pg Pool (built from DATABASE_URL when absent).
 * @param {object} [options.logger] - Structured logger.
 * @returns {object} Worker with start/stop/isHealthy/consumers.
 */
function createWorker({ config, sqs, ses, s3, pool, logger = createLogger({ service: 'notification' }) } = {}) {
  if (!config) throw new Error('createWorker requires config');

  const log = (level, message, data) => {
    logger.addTags(['worker']).addData(data)[level](message);
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
  const processor = createEmailProcessor({ logStore, sender, s3: s3Adapter, config, logger });
  const handleMessage = (body) => processor.process(body);

  const consumers = [];
  if (config.workerEnabled) {
    if (config.sqs.otpQueueUrl) {
      consumers.push(
        createConsumer({
          sqs: sqsAdapter,
          queueUrl: config.sqs.otpQueueUrl,
          name: 'otp',
          processMessage: handleMessage,
          concurrency: config.consumer.concurrency,
          maxBatch: config.consumer.maxBatch,
          logger
        })
      );
    }
    if (config.sqs.emailQueueUrl) {
      consumers.push(
        createConsumer({
          sqs: sqsAdapter,
          queueUrl: config.sqs.emailQueueUrl,
          name: 'email',
          processMessage: handleMessage,
          concurrency: config.consumer.concurrency,
          maxBatch: config.consumer.maxBatch,
          logger
        })
      );
    }
  }

  let started = false;

  return {
    consumers,
    logStore,
    processor,

    isHealthy: () => !started || consumers.every((consumer) => consumer.isRunning()),

    start: async () => {
      if (started) return { consumers: consumers.length };
      started = true;
      if (dbPool) await logStore.ensureTable();
      consumers.forEach((consumer) => consumer.start());
      if (consumers.length === 0) {
        log('info', 'Worker started with no queues configured (health endpoints only)', {});
      } else {
        log('info', 'Worker started', { queues: consumers.map((consumer) => consumer.name) });
      }
      return { consumers: consumers.length };
    },

    stop: async (timeoutMs) => {
      if (!started) return true;
      started = false;
      const results = await Promise.all(consumers.map((consumer) => consumer.stop(timeoutMs)));
      if (dbPool) await dbPool.end();
      return results.every(Boolean);
    }
  };
}

module.exports = { createWorker };
