jest.mock('@aws-sdk/client-sqs', () => {
  const send = jest.fn();
  class SQSClient {
    constructor() {
      this.send = send;
      this.destroy = jest.fn();
    }
  }
  // Plain constructor function: `new` works the same as a class, and the
  // file stays under the max-classes-per-file lint rule.
  function SendMessageCommand(input) {
    this.input = input;
  }
  return { __send: send, SQSClient, SendMessageCommand };
});

const { __send: sendMock } = require('@aws-sdk/client-sqs');
const { createSqsMailer } = require('../messaging/sqs-mailer');

const QUEUE_URL = 'http://localhost:4566/000000000000/rusuh-local-otp';

describe('createSqsMailer', () => {
  it('publishes an EMAIL_OTP envelope matching the notification contract', async () => {
    const mailer = createSqsMailer({ sqsQueueUrl: QUEUE_URL, awsRegion: 'ap-southeast-3' });
    // 2026-11-10T16:30:00Z = 23.30 WIB.
    await mailer.sendOtp({
      to: 'rina@example.com',
      code: '482019',
      locale: 'id',
      expiresAt: new Date('2026-11-10T16:30:00Z')
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const { QueueUrl, MessageBody } = sendMock.mock.calls[0][0].input;
    expect(QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(MessageBody)).toEqual({
      type: 'EMAIL_OTP',
      to: 'rina@example.com',
      locale: 'id',
      variables: {
        code: '482019',
        code_spaced: '482 019',
        expires_at: '23.30 WIB',
        email: 'rina@example.com'
      }
    });
  });

  it('formats the EN clock time and defaults the locale to id', async () => {
    const mailer = createSqsMailer({ sqsQueueUrl: QUEUE_URL });
    await mailer.sendOtp({
      to: 'b@example.com',
      code: '111222',
      locale: 'en',
      expiresAt: new Date('2026-11-10T16:30:00Z')
    });
    expect(JSON.parse(sendMock.mock.calls[0][0].input.MessageBody).variables.expires_at).toBe('11.30 pm WIB');

    await mailer.sendOtp({ to: 'c@example.com', code: '333444', expiresAt: new Date('2026-11-10T16:30:00Z') });
    expect(JSON.parse(sendMock.mock.calls[1][0].input.MessageBody).locale).toBe('id');
  });
});
