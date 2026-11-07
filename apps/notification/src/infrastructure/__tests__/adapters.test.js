const { createSqsAdapter } = require('../sqs');
const { createSesAdapter } = require('../ses');
const { createS3Adapter } = require('../s3');
const { createDbPool } = require('../db');

describe('SQS adapter', () => {
  it('maps received messages and deletes by receipt handle', async () => {
    const sent = [];
    const fakeClient = {
      send: jest.fn(async (command) => {
        sent.push(command.constructor.name);
        if (command.constructor.name === 'ReceiveMessageCommand') {
          return {
            Messages: [
              {
                MessageId: 'msg-1',
                ReceiptHandle: 'rh-1',
                Body: '{"type":"EMAIL_OTP"}',
                Attributes: { ApproximateReceiveCount: '1' }
              }
            ]
          };
        }
        return {};
      })
    };
    const sqs = createSqsAdapter({ region: 'ap-southeast-3', client: fakeClient });
    const messages = await sqs.receive('https://sqs.example/q', { maxMessages: 5, waitTimeSeconds: 20 });
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('msg-1');
    expect(messages[0].body).toBe('{"type":"EMAIL_OTP"}');
    expect(messages[0].attributes.ApproximateReceiveCount).toBe('1');
    await sqs.delete('https://sqs.example/q', 'rh-1');
    expect(sent).toEqual(['ReceiveMessageCommand', 'DeleteMessageCommand']);
  });

  it('returns an empty array when the queue is empty', async () => {
    const fakeClient = { send: jest.fn(async () => ({})) };
    const sqs = createSqsAdapter({ region: 'ap-southeast-3', client: fakeClient });
    await expect(sqs.receive('https://sqs.example/q')).resolves.toEqual([]);
  });
});

describe('SES adapter', () => {
  it('sends a plain email and returns the SES message id', async () => {
    const fakeClient = { send: jest.fn(async () => ({ MessageId: 'ses-1' })) };
    const ses = createSesAdapter({ region: 'ap-southeast-3', client: fakeClient });
    const id = await ses.sendEmail({
      from: 'noreply@rusuh-tiket.web.id',
      to: 'user@example.id',
      subject: 'Kode OTP',
      text: 'Kode Anda: 123456'
    });
    expect(id).toBe('ses-1');
    expect(fakeClient.send).toHaveBeenCalledTimes(1);
  });

  it('sends a raw email for attachments', async () => {
    const fakeClient = { send: jest.fn(async () => ({ MessageId: 'ses-2' })) };
    const ses = createSesAdapter({ region: 'ap-southeast-3', client: fakeClient });
    const id = await ses.sendRawEmail({
      from: 'noreply@rusuh-tiket.web.id',
      to: 'user@example.id',
      raw: Buffer.from('MIME-Version: 1.0')
    });
    expect(id).toBe('ses-2');
  });
});

describe('S3 adapter', () => {
  it('downloads an object as a Buffer', async () => {
    const fakeClient = {
      send: jest.fn(async () => ({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }))
    };
    const s3 = createS3Adapter({ region: 'ap-southeast-3', client: fakeClient });
    const bytes = await s3.getObject('rusuh-tickets', 'tickets/b1/t1.pdf');
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('builds a presigned URL with the default 7-day lifetime', async () => {
    const fakeClient = {};
    const signer = jest.fn(async () => 'https://s3.example/presigned');
    const s3 = createS3Adapter({ region: 'ap-southeast-3', client: fakeClient, signer });
    const url = await s3.presignedGetUrl('rusuh-tickets', 'tickets/b1/t1.pdf');
    expect(url).toBe('https://s3.example/presigned');
    expect(signer).toHaveBeenCalledWith(fakeClient, expect.anything(), { expiresIn: 7 * 24 * 60 * 60 });
  });
});

describe('DB pool', () => {
  it('returns null without a connection string (degraded mode)', () => {
    expect(createDbPool({})).toBeNull();
  });

  it('creates a pool with the given connection string', () => {
    const FakePool = jest.fn();
    const pool = createDbPool({ connectionString: 'postgres://localhost/rusuh', PoolClass: FakePool });
    expect(FakePool).toHaveBeenCalledWith({ connectionString: 'postgres://localhost/rusuh', max: 5 });
    expect(pool).toBeInstanceOf(FakePool);
  });
});
