const { loadEnvironment } = require('../infrastructure/config/environment');
const { createContainer } = require('../container');

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

describe('createContainer', () => {
  it('throws without config', () => {
    expect(() => createContainer({})).toThrow('createContainer requires config');
    expect(() => createContainer()).toThrow('createContainer requires config');
  });

  it('builds the worker with injected adapters and a memory email_log when no pool is given', () => {
    const config = loadEnvironment({});
    const container = createContainer({ config, ...fakeAdapters(), logger: silentLogger });
    expect(container.config).toBe(config);
    expect(container.worker).toBeDefined();
    expect(container.worker.consumers).toHaveLength(0);
    expect(container.worker.isHealthy()).toBe(true);
    expect(container.logStore).toBeDefined();
    expect(container.sender).toBeDefined();
    expect(container.logger).toBe(silentLogger);
  });

  it('uses the Postgres email_log store when a pool is injected', async () => {
    const config = loadEnvironment({});
    const pool = { query: jest.fn(async () => ({ rows: [] })), end: jest.fn(async () => {}) };
    const container = createContainer({ config, ...fakeAdapters(), pool, logger: silentLogger });
    // The Postgres store only touches the pool on ensureTable/claim, so the
    // container build itself must not call query.
    expect(pool.query).not.toHaveBeenCalled();
    expect(container.logStore).toBeDefined();
    await container.logStore.ensureTable();
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS email_log');
  });

  it('builds the SQS/SES/S3 adapters from config when they are not injected', () => {
    const config = loadEnvironment({});
    const container = createContainer({ config, logger: silentLogger });
    expect(container.worker).toBeDefined();
    expect(container.sender).toBeDefined();
    expect(container.logStore).toBeDefined();
  });

  it('creates one consumer per configured queue through the container', () => {
    const config = loadEnvironment({
      SQS_OTP_QUEUE_URL: 'https://sqs.ap-southeast-3.amazonaws.com/123/rusuh-otp',
      SQS_EMAIL_QUEUE_URL: 'https://sqs.ap-southeast-3.amazonaws.com/123/rusuh-email'
    });
    const container = createContainer({ config, ...fakeAdapters(), logger: silentLogger });
    expect(container.worker.consumers.map((consumer) => consumer.name)).toEqual(['otp', 'email']);
  });

  it('logs the degraded-mode warning when DATABASE_URL is not set', () => {
    const config = loadEnvironment({});
    const logger = {
      addTags: jest.fn(() => logger),
      addData: jest.fn(() => logger),
      info: jest.fn(),
      error: jest.fn()
    };
    createContainer({ config, ...fakeAdapters(), logger });
    expect(logger.info).toHaveBeenCalledWith(
      'DATABASE_URL is not set, using in-memory email_log (degraded, non-durable)'
    );
  });
});
