const { createConsumerUseCase } = require('../consumer.use-case');

function makeSqs(batches) {
  let calls = 0;
  const deleted = [];
  return {
    deleted,
    receive: jest.fn(async () => {
      const batch = batches[calls] || [];
      calls += 1;
      return batch;
    }),
    delete: jest.fn(async (_queueUrl, receiptHandle) => {
      deleted.push(receiptHandle);
    })
  };
}

const silentLogger = { addTags: () => silentLogger, addData: () => silentLogger, info: () => {}, error: () => {} };
const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const noSleep = async () => {};

describe('createConsumerUseCase', () => {
  it('deletes messages on sent/duplicate/skipped/invalid outcomes', async () => {
    const outcomes = [{ outcome: 'sent' }, { outcome: 'duplicate' }, { outcome: 'skipped' }, { outcome: 'invalid' }];
    const batches = [
      outcomes.map((outcome, index) => ({
        messageId: `m${index}`,
        receiptHandle: `rh${index}`,
        body: JSON.stringify({ type: 'EMAIL_OTP' }),
        attributes: {}
      }))
    ];
    const sqs = makeSqs(batches);
    let call = 0;
    const processMessage = jest.fn(async () => {
      const outcome = outcomes[call];
      call += 1;
      return outcome;
    });
    const consumer = createConsumerUseCase({
      sqs,
      queueUrl: 'https://sqs.example/q',
      name: 'otp',
      processMessage,
      concurrency: 2,
      sleep: noSleep,
      logger: silentLogger
    });
    consumer.start();
    await wait(50);
    await consumer.stop(1000);
    expect(processMessage).toHaveBeenCalledTimes(4);
    expect(sqs.deleted).toEqual(['rh0', 'rh1', 'rh2', 'rh3']);
  });

  it('leaves a failed message for redelivery (no delete)', async () => {
    const sqs = makeSqs([
      [
        {
          messageId: 'm0',
          receiptHandle: 'rh0',
          body: JSON.stringify({ type: 'EMAIL_OTP' }),
          attributes: { ApproximateReceiveCount: '1' }
        }
      ]
    ]);
    const consumer = createConsumerUseCase({
      sqs,
      queueUrl: 'https://sqs.example/q',
      name: 'otp',
      processMessage: jest.fn(async () => ({ outcome: 'failed' })),
      sleep: noSleep,
      logger: silentLogger
    });
    consumer.start();
    await wait(50);
    await consumer.stop(1000);
    expect(sqs.deleted).toEqual([]);
  });

  it('deletes a non-JSON message body instead of retrying it', async () => {
    const sqs = makeSqs([[{ messageId: 'm0', receiptHandle: 'rh0', body: 'not json {', attributes: {} }]]);
    const processMessage = jest.fn();
    const consumer = createConsumerUseCase({
      sqs,
      queueUrl: 'https://sqs.example/q',
      name: 'otp',
      processMessage,
      sleep: noSleep,
      logger: silentLogger
    });
    consumer.start();
    await wait(50);
    await consumer.stop(1000);
    expect(processMessage).not.toHaveBeenCalled();
    expect(sqs.deleted).toEqual(['rh0']);
  });

  it('backs off and continues after a receive error', async () => {
    let calls = 0;
    const sqs = {
      receive: jest.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('SQS down');
        return [];
      }),
      delete: jest.fn()
    };
    const consumer = createConsumerUseCase({
      sqs,
      queueUrl: 'https://sqs.example/q',
      name: 'otp',
      processMessage: jest.fn(),
      sleep: noSleep,
      logger: silentLogger
    });
    consumer.start();
    await wait(50);
    expect(consumer.isRunning()).toBe(true);
    expect(calls).toBeGreaterThan(1);
    await consumer.stop(1000);
    expect(consumer.isRunning()).toBe(false);
  });

  it('stop waits for in-flight messages and reports cleanly', async () => {
    const sqs = makeSqs([
      [{ messageId: 'm0', receiptHandle: 'rh0', body: JSON.stringify({ type: 'EMAIL_OTP' }), attributes: {} }]
    ]);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const consumer = createConsumerUseCase({
      sqs,
      queueUrl: 'https://sqs.example/q',
      name: 'otp',
      processMessage: jest.fn(async () => {
        await gate;
        return { outcome: 'sent' };
      }),
      sleep: noSleep,
      logger: silentLogger
    });
    consumer.start();
    await wait(50);
    const stopping = consumer.stop(5000);
    release();
    await expect(stopping).resolves.toBe(true);
    expect(sqs.deleted).toEqual(['rh0']);
  });
});
