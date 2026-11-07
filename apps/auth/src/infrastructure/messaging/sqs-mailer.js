const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { SQS_QUEUES } = require('@rusuh/contracts').constants;

/**
 * SQS OTP mailer (Q34): enqueues `{to, template: "otp", code}` for the
 * notification-module (LLD-04), which sends the email via SES. The OTP code
 * is in the message (transient; SQS is encrypted in transit + at rest) and
 * is NEVER written to logs.
 *
 * @param {object} config - { sqsQueueUrl, awsRegion, environment }.
 * @returns {object} Mailer.
 */
function createSqsMailer({ sqsQueueUrl, awsRegion, environment = 'dev' }) {
  const queueUrl = sqsQueueUrl || SQS_QUEUES.notification.replace('{env}', environment);
  const client = new SQSClient({ region: awsRegion || 'ap-southeast-3' });

  return {
    async sendOtp({ to, code, locale }) {
      const body = JSON.stringify({ to, template: 'otp', code, locale: locale || 'id' });
      await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
    },

    async close() {
      client.destroy();
    }
  };
}

module.exports = { createSqsMailer };
