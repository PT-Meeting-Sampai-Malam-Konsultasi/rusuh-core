/* eslint-disable max-classes-per-file -- Memory + SQS buses share one file by design. */
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

/**
 * Event bus (SQS, ADR-0023). Two implementations behind one interface:
 *  - MemoryEventBus: in-memory, records published events (tests, local dev).
 *  - SqsEventBus: @aws-sdk/client-sqs, sends to the notification queue.
 *
 * Only the notification queue (core -> notification-module, email jobs) is
 * left. Admission registration is synchronous (POST /v1/core/admission,
 * ADR-0027), and the queue hears of bookings through stream:booking and the
 * core:* keys (BR-06-C1), which replace the SQS empty-slot message.
 */

class MemoryEventBus {
  constructor() {
    this.emailJobs = [];
  }

  async sendEmailJob(envelope) {
    this.emailJobs.push(envelope);
    return envelope;
  }
}

class SqsEventBus {
  /**
   * @param {object} options
   * @param {object} options.client - SQSClient (@aws-sdk/client-sqs).
   * @param {string} options.notificationQueueUrl
   */
  constructor({ client, notificationQueueUrl }) {
    this.client = client;
    this.notificationQueueUrl = notificationQueueUrl;
  }

  static async create({ region, notificationQueueUrl }) {
    return new SqsEventBus({ client: new SQSClient({ region }), notificationQueueUrl });
  }

  async sendEmailJob(envelope) {
    // The envelope is sent as-is: notification-module validates the SQS body
    // strictly (unknown(false)), so no wrapper keys may be added here.
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.notificationQueueUrl, MessageBody: JSON.stringify(envelope) })
    );
    return envelope;
  }
}

module.exports = { MemoryEventBus, SqsEventBus };
