const { SESClient, SendEmailCommand, SendRawEmailCommand } = require('@aws-sdk/client-ses');

/**
 * Creates a thin SES adapter. The underlying client is injectable so tests run
 * without live AWS. The sender identity is always the configured `from`
 * address (domain verified + DKIM); Midtrans built-in email stays disabled —
 * only SES sends (Point 6).
 *
 * @param {object} options - Adapter dependencies.
 * @param {string} options.region - AWS region.
 * @param {object} [options.client] - Prebuilt SES client (tests).
 * @returns {object} SES adapter.
 */
function createSesAdapter({ region, client = new SESClient({ region }) } = {}) {
  if (!region) throw new Error('createSesAdapter requires a region');

  return {
    /**
     * Sends a plain (non-attachment) email.
     *
     * @param {object} email - Email to send.
     * @param {string} email.from - Verified sender address.
     * @param {string} email.to - Recipient address.
     * @param {string} email.subject - Subject.
     * @param {string} email.text - Plain-text body.
     * @param {string} [email.html] - HTML body.
     * @returns {Promise<string>} SES message id.
     */
    sendEmail: async ({ from, to, subject, text, html }) => {
      const output = await client.send(
        new SendEmailCommand({
          Source: from,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: text, Charset: 'UTF-8' },
              ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {})
            }
          }
        })
      );
      return output.MessageId;
    },

    /**
     * Sends a raw MIME email (used for e-tickets with a PDF attachment).
     *
     * @param {object} email - Raw email to send.
     * @param {string} email.from - Verified sender address.
     * @param {string} email.to - Recipient address.
     * @param {Buffer} email.raw - Full MIME message.
     * @returns {Promise<string>} SES message id.
     */
    sendRawEmail: async ({ from, to, raw }) => {
      const output = await client.send(
        new SendRawEmailCommand({
          Source: from,
          Destinations: [to],
          RawMessage: { Data: raw }
        })
      );
      return output.MessageId;
    }
  };
}

module.exports = { createSesAdapter };
