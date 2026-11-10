const { createMemoryMailer } = require('./memory-mailer');
const { createSqsMailer } = require('./sqs-mailer');

/**
 * Picks the mailer implementation from config: SQS when SQS_QUEUE_URL is
 * set, otherwise the in-memory mailer (tests / local dev without AWS).
 *
 * @param {object} config - Runtime configuration.
 * @returns {object} Mailer.
 */
function createMailer(config = {}) {
  if (config.sqsQueueUrl) {
    return createSqsMailer({
      sqsQueueUrl: config.sqsQueueUrl,
      awsRegion: config.awsRegion,
      environment: config.nodeEnv
    });
  }
  return createMemoryMailer();
}

module.exports = { createMailer };
