const { SqsEventBus, AdmissionConsumer, MemoryEventBus } = require('@/infrastructure/messaging/events');
const { MemoryStock } = require('@/infrastructure/cache/stock');

/** A fake SQS client: send() records the command and returns canned responses. */
function fakeSqsClient({ receiveResponse = { Messages: [] } } = {}) {
  const sent = [];
  return {
    sent,
    send: jest.fn(async (command) => {
      sent.push(command);
      if (command.constructor.name === 'ReceiveMessageCommand') return receiveResponse;
      return {};
    })
  };
}

describe('SqsEventBus (live SQS adapter, fake client)', () => {
  it('publishEmptySlot generates an id when missing and sends to the empty-slot queue', async () => {
    const client = fakeSqsClient();
    const bus = new SqsEventBus({
      client,
      emptySlotQueueUrl: 'https://sqs/empty-slot',
      notificationQueueUrl: 'https://sqs/notification'
    });
    const event = { eventId: 'evt_1', released: 1, releasedIds: ['s_1'], reason: 'expired' };
    const sent = await bus.publishEmptySlot(event);
    expect(sent.id).toBeDefined();
    expect(sent.event_id).toBe('evt_1');
    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.sent[0];
    expect(command.input.QueueUrl).toBe('https://sqs/empty-slot');
    expect(JSON.parse(command.input.MessageBody).event_id).toBe('evt_1');
  });

  it('publishEmptySlot keeps a provided id', async () => {
    const client = fakeSqsClient();
    const bus = new SqsEventBus({
      client,
      emptySlotQueueUrl: 'https://sqs/empty-slot',
      notificationQueueUrl: 'https://sqs/notification'
    });
    const sent = await bus.publishEmptySlot({
      id: 'evt-uuid-1',
      eventId: 'evt_1',
      released: 0,
      releasedIds: [],
      reason: 'x'
    });
    expect(sent.id).toBe('evt-uuid-1');
  });

  it('sendEmailJob generates enqueued_at when missing and sends to the notification queue', async () => {
    const client = fakeSqsClient();
    const bus = new SqsEventBus({
      client,
      emptySlotQueueUrl: 'https://sqs/empty-slot',
      notificationQueueUrl: 'https://sqs/notification'
    });
    const job = { booking_id: 'bk_1', type: 'e-ticket', to: 'a@example.com', payload: {} };
    const sent = await bus.sendEmailJob(job);
    expect(sent.enqueued_at).toBeDefined();
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.sent[0].input.QueueUrl).toBe('https://sqs/notification');
  });

  it('sendEmailJob keeps a provided enqueued_at', async () => {
    const client = fakeSqsClient();
    const bus = new SqsEventBus({
      client,
      emptySlotQueueUrl: 'https://sqs/empty-slot',
      notificationQueueUrl: 'https://sqs/notification'
    });
    const sent = await bus.sendEmailJob({
      booking_id: 'bk_1',
      type: 'expired',
      to: 'a@example.com',
      enqueued_at: '2026-11-07T00:00:00.000Z'
    });
    expect(sent.enqueued_at).toBe('2026-11-07T00:00:00.000Z');
  });
});

describe('AdmissionConsumer (ADR-0021/0023, fake SQS client)', () => {
  it('requires a stock', () => {
    expect(() => new AdmissionConsumer({})).toThrow('AdmissionConsumer requires stock');
    expect(() => new AdmissionConsumer()).toThrow('AdmissionConsumer requires stock');
  });

  it('handleAdmissionEvent stores a valid event and returns stored:true', async () => {
    const stock = new MemoryStock();
    const consumer = new AdmissionConsumer({ stock, client: null, queueUrl: null });
    const event = {
      admission_token: 'adm_1',
      slot_id: 's_1',
      user_id: 'acc_1',
      event_id: 'evt_1',
      max_tickets: 2,
      expires_at: new Date(Date.now() + 600000).toISOString(),
      issued_at: new Date().toISOString()
    };
    await expect(consumer.handleAdmissionEvent(event)).resolves.toEqual({ stored: true });
    const stored = await stock.getAdmission('adm_1');
    expect(stored).toMatchObject({ user_id: 'acc_1', event_id: 'evt_1', slot_id: 's_1', max_tickets: 2 });
  });

  it('handleAdmissionEvent defaults max_tickets and expires_at when missing', async () => {
    const stock = new MemoryStock();
    const consumer = new AdmissionConsumer({ stock, client: null, queueUrl: null });
    await expect(
      consumer.handleAdmissionEvent({ admission_token: 'adm_2', user_id: 'acc_2', event_id: 'evt_1' })
    ).resolves.toEqual({ stored: true });
    const stored = await stock.getAdmission('adm_2');
    expect(stored.max_tickets).toBe(3);
    expect(stored.expires_at).toBeDefined();
  });

  it('handleAdmissionEvent rejects a malformed event (no token / no user)', async () => {
    const stock = new MemoryStock();
    const consumer = new AdmissionConsumer({ stock, client: null, queueUrl: null });
    await expect(consumer.handleAdmissionEvent(null)).resolves.toEqual({ stored: false, reason: 'malformed' });
    await expect(consumer.handleAdmissionEvent({})).resolves.toEqual({ stored: false, reason: 'malformed' });
    await expect(consumer.handleAdmissionEvent({ admission_token: 'adm_3' })).resolves.toEqual({
      stored: false,
      reason: 'malformed'
    });
    await expect(consumer.handleAdmissionEvent({ user_id: 'acc_1' })).resolves.toEqual({
      stored: false,
      reason: 'malformed'
    });
  });

  it('start is a no-op without a client or queue URL, and stop clears running', () => {
    const stock = new MemoryStock();
    expect(new AdmissionConsumer({ stock, client: null, queueUrl: null }).start()).toBe(false);
    expect(new AdmissionConsumer({ stock, client: fakeSqsClient(), queueUrl: null }).start()).toBe(false);
    const consumer = new AdmissionConsumer({ stock, client: fakeSqsClient(), queueUrl: 'https://sqs/admission' });
    expect(consumer.start()).toBe(true);
    expect(consumer.running).toBe(true);
    consumer.stop();
    expect(consumer.running).toBe(false);
  });

  it('_poll handles and deletes each message, then stops when told to', async () => {
    const stock = new MemoryStock();
    const event = {
      admission_token: 'adm_9',
      slot_id: 's_9',
      user_id: 'acc_9',
      event_id: 'evt_1',
      max_tickets: 1,
      expires_at: new Date(Date.now() + 600000).toISOString()
    };
    const client = fakeSqsClient({
      receiveResponse: {
        Messages: [{ Body: JSON.stringify(event), ReceiptHandle: 'rh-1' }]
      }
    });
    const consumer = new AdmissionConsumer({ stock, client, queueUrl: 'https://sqs/admission' });
    consumer.running = true;
    await consumer._poll();
    consumer.stop();
    // Let the re-scheduled setImmediate fire (it must no-op now that running is false).
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    const stored = await stock.getAdmission('adm_9');
    expect(stored).toMatchObject({ user_id: 'acc_9' });
    expect(client.send).toHaveBeenCalledTimes(2); // receive + delete
    expect(client.sent[1].constructor.name).toBe('DeleteMessageCommand');
    expect(client.sent[1].input.ReceiptHandle).toBe('rh-1');
  });

  it('_poll calls onError for a poison message and does not delete it', async () => {
    const stock = new MemoryStock();
    const client = fakeSqsClient({
      receiveResponse: { Messages: [{ Body: 'not-json{', ReceiptHandle: 'rh-bad' }] }
    });
    const onError = jest.fn();
    const consumer = new AdmissionConsumer({ stock, client, queueUrl: 'https://sqs/admission', onError });
    consumer.running = true;
    await consumer._poll();
    consumer.stop();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledTimes(1); // receive only, no delete
  });

  it('_poll returns immediately when not running', async () => {
    const stock = new MemoryStock();
    const client = fakeSqsClient();
    const consumer = new AdmissionConsumer({ stock, client, queueUrl: 'https://sqs/admission' });
    await consumer._poll();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('MemoryEventBus.receiveAdmission records the event (test/dev helper)', async () => {
    const bus = new MemoryEventBus();
    const event = { admission_token: 'adm_x', user_id: 'acc_x' };
    await expect(bus.receiveAdmission(event)).resolves.toBe(event);
    expect(bus.admissionEvents).toEqual([event]);
  });
});
