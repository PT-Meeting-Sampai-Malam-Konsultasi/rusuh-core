const { createLogger } = require('@rusuh/observability');
const { validateJob } = require('./email.validation');
const { renderEmail } = require('./email.templates');

/**
 * Processes one notification job. Outcomes (the consumer deletes the SQS
 * message for every outcome except 'failed' and 'skipped'):
 * - 'sent'      email sent via SES (and email_log marked sent)
 * - 'duplicate' already sent before (email_log 'sent') — no-op
 * - 'skipped'   another worker is sending it now (email_log 'sending', fresh)
 * - 'invalid'   malformed envelope/variables — not retryable, delete it
 * - 'failed'    SES/S3 failure — leave the message for SQS redelivery -> DLQ
 *
 * The OTP code is rendered into the email body but NEVER logged.
 *
 * @param {object} options - Processor dependencies.
 * @param {object} options.logStore - email_log store (Postgres or memory).
 * @param {object} options.sender - Email sender (SES + retry + rate limit).
 * @param {object} options.s3 - S3 adapter (PDF fetch + presigned URLs).
 * @param {object} options.config - Runtime config ({adminEmail, s3}).
 * @param {object} [options.logger] - Structured logger.
 * @returns {object} Processor with a `process()` method.
 */
function createEmailProcessor({
  logStore,
  sender,
  s3,
  config,
  logger = createLogger({ service: 'notification' })
} = {}) {
  if (!logStore) throw new Error('createEmailProcessor requires a log store');
  if (!sender) throw new Error('createEmailProcessor requires a sender');
  if (!s3) throw new Error('createEmailProcessor requires an S3 adapter');
  if (!config) throw new Error('createEmailProcessor requires config');

  const log = (level, message, data) => {
    logger.addTags(['email', 'processor']).addData(data)[level](message);
  };

  return {
    process: async (rawJob) => {
      let job;
      try {
        job = validateJob(rawJob);
      } catch (error) {
        return { outcome: 'invalid', reason: error.message };
      }
      const correlation = {
        type: job.type,
        to: job.to,
        request_id: job.request_id || null,
        booking_id: job.booking_id || null
      };

      const usesLog = job.type === 'EMAIL_TICKET' || job.type === 'EMAIL_EXPIRED';
      let claimed = false;
      if (usesLog) {
        const claim = await logStore.claim({ bookingId: job.booking_id, type: job.type });
        if (claim.outcome === 'duplicate') {
          log('info', 'Duplicate email skipped (already sent)', correlation);
          return { outcome: 'duplicate' };
        }
        if (claim.outcome === 'in-flight') {
          log('info', 'Email already being sent by another worker', correlation);
          return { outcome: 'skipped' };
        }
        claimed = true;
      }

      try {
        let extra = {};
        if (job.type === 'EMAIL_EXPIRED') {
          extra = { admin_email: job.variables.admin_email || config.adminEmail };
        }
        let attachments = [];
        if (job.type === 'EMAIL_TICKET' && job.attachments.length > 0) {
          if (!config.s3.ticketBucket) throw new Error('S3 ticket bucket is not configured');
          const fetched = await Promise.all(
            job.attachments.map(async (attachment) => {
              const data = await s3.getObject(config.s3.ticketBucket, attachment.s3_key);
              const downloadUrl = await s3.presignedGetUrl(config.s3.ticketBucket, attachment.s3_key);
              return {
                file: { filename: attachment.s3_key.split('/').pop(), contentType: 'application/pdf', data },
                downloadUrl
              };
            })
          );
          attachments = fetched.map((item) => item.file);
          extra = { download_links: fetched.map((item) => item.downloadUrl) };
        }

        const { subject, text, html } = renderEmail(job, extra);
        const sesMessageId = await sender.send({ to: job.to, subject, text, html, attachments });
        if (usesLog) {
          await logStore.markSent({ bookingId: job.booking_id, type: job.type, sesMessageId });
        }
        log('info', 'Email sent', { ...correlation, ses_message_id: sesMessageId });
        return { outcome: 'sent', sesMessageId };
      } catch (error) {
        if (claimed) {
          await logStore.markFailed({ bookingId: job.booking_id, type: job.type });
        }
        log('error', 'Email failed', { ...correlation, error: error.message });
        return { outcome: 'failed', error: error.message };
      }
    }
  };
}

module.exports = { createEmailProcessor };
