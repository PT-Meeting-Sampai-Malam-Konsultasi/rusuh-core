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
  it('sendEmailJob sends the envelope verbatim to the notification queue', async () => {
    const client = fakeSqsClient();
    const bus = new SqsEventBus({
      client,
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

  it('create builds a bus for the notification queue only', async () => {
    const bus = await SqsEventBus.create({
      region: 'ap-southeast-3',
      notificationQueueUrl: 'https://sqs/notification'
    });
    expect(bus.notificationQueueUrl).toBe('https://sqs/notification');
    expect(bus).not.toHaveProperty('publishEmptySlot');
  });
});
