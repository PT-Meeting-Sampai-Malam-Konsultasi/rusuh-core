const { loadEnvironment } = require('../infrastructure/config/environment');
const { createWorkerUseCase } = require('../application/worker/worker.use-case');
const { createMemoryEmailLogStore } = require('../infrastructure/persistence/email-log.store');
const { createEmailSender } = require('../infrastructure/messaging/email.sender');

const silentLogger = { addTags: () => silentLogger, addData: () => silentLogger, info: () => {}, error: () => {} };

function fakeAdapters() {
  return {
    sqs: { receive: jest.fn(async () => []), delete: jest.fn() },
    ses: { sendEmail: jest.fn(async () => 'ses-1'), sendRawEmail: jest.fn(async () => 'ses-2') },
    s3: {
      getObject: jest.fn(async () => Buffer.from('pdf')),
      presignedGetUrl: jest.fn(async () => 'https://s3.example/dl')
    }
  };
}

function makeWorker(config, adapters, logger) {
  const logStore = createMemoryEmailLogStore({ staleMinutes: config.claimStaleMinutes });
  const sender = createEmailSender({
    ses: adapters.ses,
    from: config.ses.fromEmail,
    maxSendsPerSecond: config.ses.maxSendsPerSecond
  });
  return createWorkerUseCase({ config, sqs: adapters.sqs, s3: adapters.s3, pool: null, logStore, sender, logger });
}

describe('createWorkerUseCase', () => {
  it('starts with no queues when none are configured', async () => {
    const config = loadEnvironment({});
    const worker = makeWorker(config, fakeAdapters(), silentLogger);
    expect(worker.consumers).toHaveLength(0);
    expect(worker.isHealthy()).toBe(true);
    const started = await worker.start();
    expect(started).toEqual({ consumers: 0 });
    expect(worker.isHealthy()).toBe(true);
    await expect(worker.stop()).resolves.toBe(true);
  });

  it('creates one consumer per configured queue', async () => {
    const config = loadEnvironment({
      SQS_OTP_QUEUE_URL: 'https://sqs.ap-southeast-3.amazonaws.com/123/rusuh-otp',
      SQS_EMAIL_QUEUE_URL: 'https://sqs.ap-southeast-3.amazonaws.com/123/rusuh-email'
    });
    const worker = makeWorker(config, fakeAdapters(), silentLogger);
    expect(worker.consumers.map((consumer) => consumer.name)).toEqual(['otp', 'email']);
    await worker.start();
    expect(worker.isHealthy()).toBe(true);
    expect(worker.consumers.every((consumer) => consumer.isRunning())).toBe(true);
    await expect(worker.stop()).resolves.toBe(true);
    expect(worker.isHealthy()).toBe(true);
  });

  it('does not start any consumer when the worker is disabled', async () => {
    const config = loadEnvironment({
      WORKER_ENABLED: 'false',
      SQS_OTP_QUEUE_URL: 'https://sqs.ap-southeast-3.amazonaws.com/123/rusuh-otp'
    });
    const worker = makeWorker(config, fakeAdapters(), silentLogger);
    expect(worker.consumers).toHaveLength(0);
    await worker.start();
    await expect(worker.stop()).resolves.toBe(true);
  });

  it('processes an OTP job end-to-end through the fake queue', async () => {
    const config = loadEnvironment({
      SQS_OTP_QUEUE_URL: 'https://sqs.ap-southeast-3.amazonaws.com/123/rusuh-otp'
    });
    const adapters = fakeAdapters();
    const otpJob = { type: 'EMAIL_OTP', to: 'user@example.id', variables: { code: '123456', expires_in: 10 } };
    let calls = 0;
    adapters.sqs.receive = jest.fn(async () => {
      calls += 1;
      return calls === 1
        ? [{ messageId: 'm1', receiptHandle: 'rh1', body: JSON.stringify(otpJob), attributes: {} }]
        : [];
    });
    const worker = makeWorker(config, adapters, silentLogger);
    await worker.start();
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    await worker.stop();
    expect(adapters.ses.sendEmail).toHaveBeenCalledTimes(1);
    expect(adapters.sqs.delete).toHaveBeenCalledWith(expect.stringContaining('rusuh-otp'), 'rh1');
  });
});
