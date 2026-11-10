/* eslint-disable max-classes-per-file -- Memory + SQS buses share one file by design. */
const crypto = require('crypto');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

/**
 * Event bus (SQS, ADR-0023). Two implementations behind one interface:
 *  - MemoryEventBus: in-memory, records published events (tests, local dev).
 *  - SqsEventBus: @aws-sdk/client-sqs, sends to the configured queue URLs.
 *
 * Queues (logical): empty-slot (core -> queue), notification
 * (core -> notification-module, email jobs). The admission queue is gone:
 * admission registration is synchronous via POST /v1/core/admission
 * (ADR-0027 replaces the SQS admission event, ADR-0021/0023).
 * Physical names follow the infra convention: rusuh-<env>-<name>.
 */

function emptySlotEvent({ eventId, released, releasedIds, reason }) {
  return {
    id: crypto.randomUUID(),
    event_id: eventId,
    released,
    released_ids: releasedIds,
    reason,
    emitted_at: new Date().toISOString()
  };
}

class MemoryEventBus {
  constructor() {
    this.emptySlotEvents = [];
    this.emailJobs = [];
  }

  async publishEmptySlot(event) {
    const full = event.id ? event : emptySlotEvent(event);
    this.emptySlotEvents.push(full);
    return full;
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
   * @param {string} options.emptySlotQueueUrl
   * @param {string} options.notificationQueueUrl
   */
  constructor({ client, emptySlotQueueUrl, notificationQueueUrl }) {
    this.client = client;
    this.emptySlotQueueUrl = emptySlotQueueUrl;
    this.notificationQueueUrl = notificationQueueUrl;
  }

  static async create({ region, emptySlotQueueUrl, notificationQueueUrl }) {
    return new SqsEventBus({
      client: new SQSClient({ region }),
      emptySlotQueueUrl,
      notificationQueueUrl
    });
  }

  async _send(queueUrl, body) {
    await this.client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(body) }));
    return body;
  }

  async publishEmptySlot(event) {
    const full = event.id ? event : emptySlotEvent(event);
    return this._send(this.emptySlotQueueUrl, full);
  }

  async sendEmailJob(envelope) {
    // The envelope is sent as-is: notification-module validates the SQS body
    // strictly (unknown(false)), so no wrapper keys may be added here.
    return this._send(this.notificationQueueUrl, envelope);
  }
}

module.exports = { MemoryEventBus, SqsEventBus, emptySlotEvent };
