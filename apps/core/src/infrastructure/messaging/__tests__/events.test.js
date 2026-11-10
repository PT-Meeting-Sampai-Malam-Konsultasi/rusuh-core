const { SqsEventBus } = require('@/infrastructure/messaging/events');

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

  it('sendEmailJob sends the envelope verbatim to the notification queue', async () => {
    const client = fakeSqsClient();
    const bus = new SqsEventBus({
      client,
      emptySlotQueueUrl: 'https://sqs/empty-slot',
      notificationQueueUrl: 'https://sqs/notification'
    });
    // notification-module validates the SQS body strictly (unknown(false)):
    // the bus must not add wrapper keys (e.g. enqueued_at) to the envelope.
    const envelope = {
      type: 'EMAIL_TICKET',
      to: 'buyer@example.com',
      locale: 'id',
      booking_id: 'bk_1',
      variables: { order_code: 'RSH-ABC-123' }
    };
    const sent = await bus.sendEmailJob(envelope);
    expect(sent).toBe(envelope);
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.sent[0].input.QueueUrl).toBe('https://sqs/notification');
    expect(JSON.parse(client.sent[0].input.MessageBody)).toEqual(envelope);
  });
});
