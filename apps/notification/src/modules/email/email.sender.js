const crypto = require('crypto');

/**
 * Builds a MIME multipart/mixed message (text + html + attachments).
 *
 * @param {object} message - Message parts.
 * @param {string} message.from - Sender.
 * @param {string} message.to - Recipient.
 * @param {string} message.subject - Subject.
 * @param {string} message.text - Plain-text body.
 * @param {string} [message.html] - HTML body.
 * @param {object[]} [message.attachments] - Attachments ({filename, contentType, data}).
 * @returns {Buffer} Raw MIME message.
 */
function buildMimeMessage({ from, to, subject, text, html, attachments = [] }) {
  const boundary = `rusuh-${crypto.randomBytes(12).toString('hex')}`;
  const altBoundary = `rusuh-alt-${crypto.randomBytes(12).toString('hex')}`;
  const parts = [];
  parts.push(`From: ${from}`);
  parts.push(`To: ${to}`);
  parts.push(`Subject: ${subject}`);
  parts.push('MIME-Version: 1.0');
  parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  parts.push('');
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  parts.push('');
  parts.push(`--${altBoundary}`);
  parts.push('Content-Type: text/plain; charset="UTF-8"');
  parts.push('Content-Transfer-Encoding: 7bit');
  parts.push('');
  parts.push(text);
  if (html) {
    parts.push(`--${altBoundary}`);
    parts.push('Content-Type: text/html; charset="UTF-8"');
    parts.push('Content-Transfer-Encoding: 7bit');
    parts.push('');
    parts.push(html);
  }
  parts.push(`--${altBoundary}--`);
  attachments.forEach((attachment) => {
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: ${attachment.contentType}; name="${attachment.filename}"`);
    parts.push('Content-Transfer-Encoding: base64');
    parts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
    parts.push('');
    parts.push(attachment.data.toString('base64').replace(/(.{76})/g, '$1\n'));
  });
  parts.push(`--${boundary}--`);
  parts.push('');
  return Buffer.from(parts.join('\r\n'), 'utf8');
}

/**
 * Creates a rate limiter (token bucket per second). The sleep function is
 * injectable so tests never actually wait.
 *
 * @param {object} options - Limiter options.
 * @param {number} options.maxPerSecond - Max sends per second.
 * @param {Function} [options.sleep] - Sleep (ms) implementation.
 * @param {Function} [options.now] - Clock (tests).
 * @returns {object} Limiter with an `acquire()` method.
 */
function createRateLimiter({
  maxPerSecond,
  sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  now = () => Date.now()
} = {}) {
  const sentAt = [];
  return {
    acquire: async () => {
      const current = now();
      while (sentAt.length > 0 && sentAt[0] <= current - 1000) sentAt.shift();
      if (sentAt.length >= maxPerSecond) {
        await sleep(sentAt[0] + 1000 - current);
        return;
      }
      sentAt.push(now());
    }
  };
}

/**
 * Creates the email sender: rate-limited SES send with retry.
 * Retries only transient failures (SES 5xx / throttling); a persistent
 * failure throws so the job returns to the queue (SQS redelivery -> DLQ).
 *
 * @param {object} options - Sender dependencies.
 * @param {object} options.ses - SES adapter (createSesAdapter).
 * @param {string} options.from - Verified sender address.
 * @param {number} [options.maxSendsPerSecond] - SES rate cap (default 10).
 * @param {number} [options.maxAttempts] - Send attempts per job (default 3).
 * @param {object} [options.limiter] - Injected rate limiter (tests).
 * @param {Function} [options.sleep] - Sleep (ms) implementation (tests).
 * @returns {object} Sender with a `send()` method.
 */
function createEmailSender({
  ses,
  from,
  maxSendsPerSecond = 10,
  maxAttempts = 3,
  limiter,
  sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    })
} = {}) {
  if (!ses) throw new Error('createEmailSender requires an SES adapter');
  if (!from) throw new Error('createEmailSender requires a from address');
  const rateLimiter = limiter || createRateLimiter({ maxPerSecond: maxSendsPerSecond, sleep });

  return {
    /**
     * Sends one email (plain, or raw MIME when attachments are present).
     *
     * @param {object} email - Email to send.
     * @param {string} email.to - Recipient.
     * @param {string} email.subject - Subject.
     * @param {string} email.text - Plain-text body.
     * @param {string} [email.html] - HTML body.
     * @param {object[]} [email.attachments] - Attachments ({filename, contentType, data}).
     * @returns {Promise<string>} SES message id.
     */
    send: async ({ to, subject, text, html, attachments = [] }) => {
      const attemptSend = async (attempt) => {
        await rateLimiter.acquire();
        try {
          if (attachments.length > 0) {
            const raw = buildMimeMessage({ from, to, subject, text, html, attachments });
            return await ses.sendRawEmail({ from, to, raw });
          }
          return await ses.sendEmail({ from, to, subject, text, html });
        } catch (error) {
          if (attempt >= maxAttempts) throw error;
          await sleep(200 * 2 ** (attempt - 1));
          return attemptSend(attempt + 1);
        }
      };
      return attemptSend(1);
    }
  };
}

module.exports = { createEmailSender, createRateLimiter, buildMimeMessage };
