const { createEmailUseCase } = require('@/application/email/email.use-case');
const { createConsumerUseCase } = require('@/application/consumer/consumer.use-case');

/** Chainable console logger used when no logger is injected. */
const fallbackLogger = {
  addTags: () => fallbackLogger,
  addData: () => fallbackLogger,
  info: (...args) => console.info(...args),
  error: (...args) => console.error(...args)
};

/**
 * Worker use case: one SQS consumer per configured queue (otp + email,
 * LLD-04 §2), sharing one email processor. The worker is the only thing
 * that sends email in the whole system (auth/core never call SES directly).
 *
 * The adapters (SQS, S3, email_log store, sender, pg pool) are injected
 * by the composition root (src/container.js) — this file never requires()
 * an infrastructure file.
 *
 * @param {object} options - Use-case dependencies.
 * @param {object} options.config - Validated runtime configuration.
 * @param {import('../../domain/ports/ports').QueuePort} options.sqs - SQS adapter.
 * @param {import('../../domain/ports/ports').TicketStorePort} options.s3 - S3 adapter.
 * @param {object} [options.pool] - pg Pool (ended on stop when present).
 * @param {import('../../domain/ports/ports').EmailLogPort} options.logStore - email_log store.
 * @param {import('../../domain/ports/ports').EmailSenderPort} options.sender - Email sender.
 * @param {import('../../domain/ports/ports').LoggerPort} [options.logger] - Structured logger.
 * @returns {object} Worker with start/stop/isHealthy/consumers.
 */
function createWorkerUseCase({ config, sqs, s3, pool, logStore, sender, logger = fallbackLogger } = {}) {
  if (!config) throw new Error('createWorkerUseCase requires config');
  if (!sqs) throw new Error('createWorkerUseCase requires an SQS adapter');
  if (!s3) throw new Error('createWorkerUseCase requires an S3 adapter');
  if (!logStore) throw new Error('createWorkerUseCase requires a log store');
  if (!sender) throw new Error('createWorkerUseCase requires a sender');

  const log = (level, message, data) => {
    logger.addTags(['worker']).addData(data)[level](message);
  };

  const processor = createEmailUseCase({ logStore, sender, s3, config, logger });
  const handleMessage = (body) => processor.process(body);

  const consumers = [];
  if (config.workerEnabled) {
    if (config.sqs.otpQueueUrl) {
      consumers.push(
        createConsumerUseCase({
          sqs,
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
        createConsumerUseCase({
          sqs,
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

    isHealthy: () => !started || consumers.every((consumer) => consumer.isRunning()),

    start: async () => {
      if (started) return { consumers: consumers.length };
      started = true;
      await logStore.ensureTable();
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
      if (pool) await pool.end();
      return results.every(Boolean);
    }
  };
}

module.exports = { createWorkerUseCase };
