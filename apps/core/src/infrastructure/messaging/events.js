/* eslint-disable max-classes-per-file -- Memory + SQS buses + consumer share one file by design. */
const crypto = require('crypto');
const { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

/**
 * Event bus (SQS, ADR-0023). Two implementations behind one interface:
 *  - MemoryEventBus: in-memory, records published events (tests, local dev).
 *  - SqsEventBus: @aws-sdk/client-sqs, sends to the configured queue URLs.
 *
 * Queues (logical): admission (queue -> core), empty-slot (core -> queue),
 * notification (core -> notification-module, email jobs).
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

function emailJob({ bookingId, type, to, payload }) {
  return {
    booking_id: bookingId,
    type, // 'e-ticket' | 'expired'
    to,
    ...payload,
    enqueued_at: new Date().toISOString()
  };
}

class MemoryEventBus {
  constructor() {
    this.emptySlotEvents = [];
    this.emailJobs = [];
    this.admissionEvents = [];
  }

  async publishEmptySlot(event) {
    const full = event.id ? event : emptySlotEvent(event);
    this.emptySlotEvents.push(full);
    return full;
  }

  async sendEmailJob(job) {
    const full = job.enqueued_at ? job : emailJob(job);
    this.emailJobs.push(full);
    return full;
  }

  /** Test/dev helper: inject an admission event as if it arrived from SQS. */
  async receiveAdmission(event) {
    this.admissionEvents.push(event);
    return event;
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

  async sendEmailJob(job) {
    const full = job.enqueued_at ? job : emailJob(job);
    return this._send(this.notificationQueueUrl, full);
  }
}

/**
 * Admission event consumer (queue -> core, ADR-0021/0023).
 * Consumes the admission SQS queue (long polling, 20 s) and stores each
 * admission entry in Valkey with TTL 16 minutes (set when the user enters
 * Detail — here, when the event is consumed; the Detail-entry TTL is set by
 * the bookings flow when the user actually opens Detail).
 * Idempotent: storing the same entry twice is a no-op.
 */
class AdmissionConsumer {
  /**
   * @param {object} options
   * @param {object} options.stock - Stock adapter (setAdmission).
   * @param {object} [options.client] - SQSClient (required for polling).
   * @param {string} [options.queueUrl] - Admission queue URL.
   * @param {number} [options.ttlMs] - Admission entry TTL (default 16 min).
   * @param {Function} [options.onError] - Error hook (logging).
   */
  constructor({ stock, client, queueUrl, ttlMs = 16 * 60 * 1000, onError = () => {} } = {}) {
    if (!stock) throw new Error('AdmissionConsumer requires stock');
    this.stock = stock;
    this.client = client || null;
    this.queueUrl = queueUrl || null;
    this.ttlMs = ttlMs;
    this.onError = onError;
    this.running = false;
  }

  /**
   * Handles one admission event (also the unit-testable entry point).
   * Schema (LLD-02 §13): { admission_token, slot_id, user_id, event_id,
   * max_tickets, expires_at, issued_at }.
   *
   * @param {object} event - Admission event.
   * @returns {Promise<{stored: boolean, reason?: string}>}
   */
  async handleAdmissionEvent(event) {
    if (!event || typeof event.admission_token !== 'string' || typeof event.user_id !== 'string') {
      return { stored: false, reason: 'malformed' };
    }
    const entry = {
      user_id: event.user_id,
      event_id: event.event_id,
      slot_id: event.slot_id || null,
      max_tickets: event.max_tickets || 3,
      expires_at: event.expires_at || new Date(Date.now() + this.ttlMs).toISOString()
    };
    const ttlMs = Math.max(new Date(entry.expires_at).getTime() - Date.now(), 1000);
    await this.stock.setAdmission(event.admission_token, entry, Math.min(ttlMs, this.ttlMs));
    return { stored: true };
  }

  /** Starts long-polling the admission queue (no-op when no SQS is configured). */
  start() {
    if (!this.client || !this.queueUrl) return false;
    this.running = true;
    this._poll();
    return true;
  }

  stop() {
    this.running = false;
  }

  async _poll() {
    if (!this.running) return;
    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 60
        })
      );
      // Messages are independent: handle + delete each in parallel.
      await Promise.all(
        (response.Messages || []).map(async (message) => {
          try {
            const event = JSON.parse(message.Body);
            await this.handleAdmissionEvent(event);
            await this.client.send(
              new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle })
            );
          } catch (error) {
            this.onError(error);
            // No delete: the message becomes visible again (redrive/DLQ handles poison).
          }
        })
      );
    } catch (error) {
      this.onError(error);
      await new Promise((resolve) => {
        setTimeout(resolve, 5000);
      });
    }
    if (this.running) setImmediate(() => this._poll());
  }
}

module.exports = { MemoryEventBus, SqsEventBus, AdmissionConsumer, emptySlotEvent, emailJob };
