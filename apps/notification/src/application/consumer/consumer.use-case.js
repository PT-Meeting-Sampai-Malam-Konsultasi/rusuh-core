/** Chainable console logger used when no logger is injected. */
const fallbackLogger = {
  addTags: () => fallbackLogger,
  addData: () => fallbackLogger,
  info: (...args) => console.info(...args),
  error: (...args) => console.error(...args)
};

/** Outcomes for which the SQS message is deleted (not redelivered). */
const DELETE_OUTCOMES = new Set(['sent', 'duplicate', 'skipped', 'invalid']);

/**
 * Consumer use case: long-polls one queue, processes each message,
 * deletes it on a terminal outcome, leaves it for redelivery on failure
 * (visibility timeout -> retry -> DLQ after maxReceiveCount).
 *
 * The SQS adapter is the injected QueuePort (domain/ports/ports.js) —
 * this file never requires() an infrastructure file.
 *
 * @param {object} options - Use-case dependencies.
 * @param {import('../../domain/ports/ports').QueuePort} options.sqs - SQS adapter.
 * @param {string} options.queueUrl - Queue URL.
 * @param {string} options.name - Consumer name (otp | email, for logs).
 * @param {Function} options.processMessage - Async (parsed body) => {outcome}.
 * @param {number} [options.concurrency] - Max parallel messages per batch (default 5).
 * @param {number} [options.maxBatch] - Max messages per poll (default 10).
 * @param {number} [options.waitTimeSeconds] - Long-poll duration (default 20).
 * @param {number} [options.pollErrorDelayMs] - Delay after a receive error (default 1000).
 * @param {Function} [options.sleep] - Sleep (ms) implementation (tests).
 * @param {import('../../domain/ports/ports').LoggerPort} [options.logger] - Structured logger.
 * @returns {object} Use case with start/stop/isRunning.
 */
function createConsumerUseCase({
  sqs,
  queueUrl,
  name,
  processMessage,
  concurrency = 5,
  maxBatch = 10,
  waitTimeSeconds = 20,
  pollErrorDelayMs = 1000,
  sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  logger = fallbackLogger
} = {}) {
  if (!sqs) throw new Error('createConsumerUseCase requires an SQS adapter');
  if (!queueUrl) throw new Error('createConsumerUseCase requires a queue URL');
  if (!processMessage) throw new Error('createConsumerUseCase requires a processMessage function');

  let running = false;
  let loopPromise = null;
  let inFlight = 0;

  const log = (level, message, data) => {
    logger.addTags(['consumer', name]).addData(data)[level](message);
  };

  const processOne = async (message) => {
    inFlight += 1;
    try {
      let body;
      try {
        body = JSON.parse(message.body);
      } catch (_error) {
        log('error', 'Message body is not JSON, deleting', { message_id: message.messageId });
        await sqs.delete(queueUrl, message.receiptHandle);
        return;
      }
      const result = await processMessage(body);
      if (DELETE_OUTCOMES.has(result.outcome)) {
        await sqs.delete(queueUrl, message.receiptHandle);
      } else {
        log('info', 'Leaving message for redelivery (failed outcome)', {
          message_id: message.messageId,
          outcome: result.outcome,
          receive_count: message.attributes.ApproximateReceiveCount
        });
      }
    } catch (error) {
      log('error', 'Message processing threw, leaving for redelivery', {
        message_id: message.messageId,
        error: error.message
      });
    } finally {
      inFlight -= 1;
    }
  };

  const processBatch = async (messages) => {
    const chunks = [];
    for (let i = 0; i < messages.length; i += concurrency) chunks.push(messages.slice(i, i + concurrency));
    await chunks.reduce(
      (previous, chunk) => previous.then(() => Promise.all(chunk.map((message) => processOne(message)))),
      Promise.resolve()
    );
  };

  const pollOnce = async () => {
    const messages = await sqs.receive(queueUrl, { maxMessages: maxBatch, waitTimeSeconds });
    if (messages.length > 0) {
      log('info', 'Received batch', { count: messages.length });
      await processBatch(messages);
    }
    return messages.length;
  };

  /* eslint-disable no-await-in-loop -- poll loop: each iteration awaits one
     long-poll (20s) and then processes a batch; the loop is the worker's lifetime. */
  const loop = async () => {
    while (running) {
      try {
        const count = await pollOnce();
        if (count === 0) {
          // Yield to the event loop so timers and shutdown can run between polls.
          await new Promise((resolve) => {
            setImmediate(resolve);
          });
        }
      } catch (error) {
        log('error', 'Receive failed, backing off', { error: error.message });
        await sleep(pollErrorDelayMs);
      }
    }
  };
  /* eslint-enable no-await-in-loop */

  return {
    name,
    queueUrl,
    isRunning: () => running,

    start: () => {
      if (running) return;
      running = true;
      loopPromise = loop();
      log('info', 'Consumer started', { queue_url: queueUrl });
    },

    stop: async (timeoutMs = 30000) => {
      if (!running) return true;
      running = false;
      const stopped = await Promise.race([
        loopPromise.then(() => true),
        new Promise((resolve) => {
          setTimeout(() => resolve(false), timeoutMs);
        })
      ]);
      log('info', stopped ? 'Consumer stopped cleanly' : 'Consumer stop timed out', { in_flight: inFlight });
      return stopped;
    }
  };
}

module.exports = { createConsumerUseCase };
