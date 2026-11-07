const { loadEnvironment } = require('../environment');

describe('loadEnvironment', () => {
  it('defaults the port for this service', () => {
    expect(loadEnvironment({}).port).toBe(8084);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnvironment({ PORT: 'not-a-port' })).toThrow('Invalid environment configuration');
  });

  it('defaults AWS region and SES sender', () => {
    const config = loadEnvironment({});
    expect(config.aws.region).toBe('ap-southeast-3');
    expect(config.ses.fromEmail).toBe('noreply@rusuh-tiket.web.id');
    expect(config.ses.maxSendsPerSecond).toBe(10);
    expect(config.adminEmail).toBe('admin@rusuh-tiket.web.id');
  });

  it('leaves queue URLs and database empty by default (worker disabled)', () => {
    const config = loadEnvironment({});
    expect(config.sqs.otpQueueUrl).toBe('');
    expect(config.sqs.emailQueueUrl).toBe('');
    expect(config.databaseUrl).toBe('');
    expect(config.workerEnabled).toBe(true);
  });

  it('reads queue URLs, database and limits from the environment', () => {
    const config = loadEnvironment({
      SQS_OTP_QUEUE_URL: 'https://sqs.ap-southeast-3.amazonaws.com/123/rusuh-otp',
      SQS_EMAIL_QUEUE_URL: 'https://sqs.ap-southeast-3.amazonaws.com/123/rusuh-email',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/rusuh',
      SES_MAX_SENDS_PER_SECOND: '5',
      CONSUMER_CONCURRENCY: '3',
      CLAIM_STALE_MINUTES: '10',
      WORKER_ENABLED: 'false'
    });
    expect(config.sqs.otpQueueUrl).toContain('rusuh-otp');
    expect(config.sqs.emailQueueUrl).toContain('rusuh-email');
    expect(config.databaseUrl).toContain('postgres://');
    expect(config.ses.maxSendsPerSecond).toBe(5);
    expect(config.consumer.concurrency).toBe(3);
    expect(config.claimStaleMinutes).toBe(10);
    expect(config.workerEnabled).toBe(false);
  });
});
