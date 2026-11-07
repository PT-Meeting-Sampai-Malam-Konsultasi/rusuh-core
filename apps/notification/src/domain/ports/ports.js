/**
 * Port interfaces (domain/ports): the adapter contracts the application
 * layer depends on. These are JSDoc typedefs only — no runtime code.
 * Adapters (infrastructure/) implement them; use cases (application/)
 * receive them as injected arguments and never require() an adapter file.
 *
 * @typedef {object} QueuePort - SQS queue adapter (receive + delete).
 * @property {Function} receive - Long-polls one queue.
 *   (queueUrl: string, options?: {maxMessages?: number, waitTimeSeconds?: number})
 *   => Promise<Array<{messageId: string, receiptHandle: string, body: string, attributes: object}>>.
 * @property {Function} delete - Deletes a processed message.
 *   (queueUrl: string, receiptHandle: string) => Promise<void>.
 *
 * @typedef {object} EmailSenderPort - Rate-limited email sender (SES + retry).
 * @property {Function} send - Sends one email.
 *   ({to: string, subject: string, text: string, html?: string,
 *     attachments?: Array<{filename: string, contentType: string, data: Buffer}>})
 *   => Promise<string> (provider message id).
 *
 * @typedef {object} TicketStorePort - S3 ticket-PDF store.
 * @property {Function} getObject - Downloads an object as a Buffer.
 *   (bucket: string, key: string) => Promise<Buffer>.
 * @property {Function} presignedGetUrl - Builds a presigned GET URL.
 *   (bucket: string, key: string, expiresInSeconds?: number) => Promise<string>.
 *
 * @typedef {object} EmailLogPort - email_log dedup store (claim pattern).
 * @property {Function} ensureTable - Creates the table if missing (no-op for memory).
 *   () => Promise<void>.
 * @property {Function} claim - Claims a (bookingId, type) send.
 *   ({bookingId: string, type: string})
 *   => Promise<{outcome: 'claimed' | 'duplicate' | 'in-flight', row: object|null}>.
 * @property {Function} markSent - Marks a claim sent.
 *   ({bookingId: string, type: string, sesMessageId?: string}) => Promise<void>.
 * @property {Function} markFailed - Marks a claim failed (retryable).
 *   ({bookingId: string, type: string}) => Promise<void>.
 *
 * @typedef {object} LoggerPort - Structured logger (chainable tags/data).
 * @property {Function} addTags - Adds log tags, returns the logger.
 * @property {Function} addData - Adds log fields, returns the logger.
 * @property {Function} info - Logs at info level.
 * @property {Function} error - Logs at error level.
 */

module.exports = {};
