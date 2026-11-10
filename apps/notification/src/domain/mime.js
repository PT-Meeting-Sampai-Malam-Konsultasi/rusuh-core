/**
 * Pure MIME message builder (domain): builds a multipart/mixed message
 * (text + html + attachments) with no I/O. Used by the SES sender
 * (infrastructure/messaging/email.sender.js).
 */
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

module.exports = { buildMimeMessage };
