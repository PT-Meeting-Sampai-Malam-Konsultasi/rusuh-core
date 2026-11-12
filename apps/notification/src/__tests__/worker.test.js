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
    const otpJob = {
      type: 'EMAIL_OTP',
      to: 'user@example.id',
      variables: {
        code: '123456',
        code_spaced: '123&nbsp;456',
        expires_at: '21.30 WIB',
        valid_for: '10 menit',
        email: 'user@example.id'
      }
    };
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

  it('throws when a required dependency is missing', () => {
    const config = loadEnvironment({});
    const adapters = fakeAdapters();
    const logStore = createMemoryEmailLogStore({ staleMinutes: config.claimStaleMinutes });
    const sender = createEmailSender({
      ses: adapters.ses,
      from: config.ses.fromEmail,
      maxSendsPerSecond: config.ses.maxSendsPerSecond
    });
    const base = { config, sqs: adapters.sqs, s3: adapters.s3, pool: null, logStore, sender, logger: silentLogger };
    expect(() => createWorkerUseCase({ ...base, config: undefined })).toThrow('requires config');
    expect(() => createWorkerUseCase({ ...base, sqs: undefined })).toThrow('requires an SQS adapter');
    expect(() => createWorkerUseCase({ ...base, s3: undefined })).toThrow('requires an S3 adapter');
    expect(() => createWorkerUseCase({ ...base, logStore: undefined })).toThrow('requires a log store');
    expect(() => createWorkerUseCase({ ...base, sender: undefined })).toThrow('requires a sender');
  });

  it('ends the pool on stop and returns true when never started', async () => {
    const config = loadEnvironment({});
    const adapters = fakeAdapters();
    const pool = { end: jest.fn(async () => {}) };
    const logStore = createMemoryEmailLogStore({ staleMinutes: config.claimStaleMinutes });
    const sender = createEmailSender({
      ses: adapters.ses,
      from: config.ses.fromEmail,
      maxSendsPerSecond: config.ses.maxSendsPerSecond
    });
    const worker = createWorkerUseCase({
      config,
      sqs: adapters.sqs,
      s3: adapters.s3,
      pool,
      logStore,
      sender,
      logger: silentLogger
    });
    await expect(worker.stop()).resolves.toBe(true);
    expect(pool.end).not.toHaveBeenCalled();
    await worker.start();
    await expect(worker.stop()).resolves.toBe(true);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('start is idempotent', async () => {
    const config = loadEnvironment({});
    const worker = makeWorker(config, fakeAdapters(), silentLogger);
    const first = await worker.start();
    const second = await worker.start();
    expect(first).toEqual({ consumers: 0 });
    expect(second).toEqual({ consumers: 0 });
    await worker.stop();
  });

  it('uses the fallback console logger when no logger is injected', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const config = loadEnvironment({});
      const adapters = fakeAdapters();
      const logStore = createMemoryEmailLogStore({ staleMinutes: config.claimStaleMinutes });
      const sender = createEmailSender({
        ses: adapters.ses,
        from: config.ses.fromEmail,
        maxSendsPerSecond: config.ses.maxSendsPerSecond
      });
      const worker = createWorkerUseCase({ config, sqs: adapters.sqs, s3: adapters.s3, pool: null, logStore, sender });
      await worker.start();
      await worker.stop();
      expect(infoSpy).toHaveBeenCalledWith('Worker started with no queues configured (health endpoints only)');
    } finally {
      infoSpy.mockRestore();
    }
  });
});
