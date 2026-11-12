const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { formatOtpExpiry, spaceOtpCode } = require('@/domain/otp');

/**
 * SQS OTP mailer (Q34): enqueues an EMAIL_OTP job for the notification-module
 * (LLD-04), which renders the e-mail and sends it via SES. The envelope
 * follows the notification contract (application/email/email.validation.js):
 * {type, to, locale, variables:{code, code_spaced, expires_at, valid_for,
 * email}}. Values are pre-formatted by the caller/use case (the templates do
 * no formatting; valid_for carries the configured OTP_TTL_MS, e.g. "5 menit").
 * The code is in the message (transient; SQS is encrypted in transit + at
 * rest) and is NEVER written to logs.
 *
 * @param {object} config - { sqsQueueUrl, awsRegion }.
 * @returns {object} Mailer.
 */
function createSqsMailer({ sqsQueueUrl, awsRegion }) {
  const client = new SQSClient({ region: awsRegion || 'ap-southeast-3' });

  return {
    async sendOtp({ to, code, locale, expiresAt, validFor }) {
      const language = locale || 'id';
      const body = JSON.stringify({
        type: 'EMAIL_OTP',
        to,
        locale: language,
        variables: {
          code,
          code_spaced: spaceOtpCode(code),
          expires_at: formatOtpExpiry(expiresAt, language),
          valid_for: validFor,
          email: to
        }
      });
      await client.send(new SendMessageCommand({ QueueUrl: sqsQueueUrl, MessageBody: body }));
    },

    async close() {
      client.destroy();
    }
  };
}

module.exports = { createSqsMailer };
