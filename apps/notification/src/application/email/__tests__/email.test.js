const { validateJob } = require('../email.validation');
const { renderEmail } = require('../../../domain/email.templates');
const { createMemoryEmailLogStore, decideClaim } = require('../../../infrastructure/persistence/email-log.store');
const { createEmailSender } = require('../../../infrastructure/messaging/email.sender');
const { buildMimeMessage } = require('../../../domain/mime');
const { createEmailUseCase } = require('../email.use-case');

const otpJob = {
  type: 'EMAIL_OTP',
  to: 'user@example.id',
  request_id: 'req-1',
  variables: { code: '123456', expires_in: 10 }
};

const ticketJob = {
  type: 'EMAIL_TICKET',
  to: 'user@example.id',
  request_id: 'req-2',
  booking_id: 'bk_01',
  variables: {
    event_name: 'Konser Rusuh',
    event_date: '2026-11-13',
    venue: 'GOR Jakarta',
    doors_open_at: '18:00',
    tickets: [{ category: 'VIP', gate: 'A', nik_masked: '3171****0001', ticket_code: 'SMD-FB-04827' }]
  },
  attachments: [{ s3_key: 'tickets/bk_01/SMD-FB-04827.pdf' }]
};

const expiredJob = {
  type: 'EMAIL_EXPIRED',
  to: 'user@example.id',
  request_id: 'req-3',
  booking_id: 'bk_02',
  variables: { event_name: 'Konser Rusuh', booking_id: 'bk_02' }
};

describe('validateJob', () => {
  it('accepts a valid OTP job', () => {
    const job = validateJob(otpJob);
    expect(job.type).toBe('EMAIL_OTP');
    expect(job.variables.code).toBe('123456');
  });

  it('rejects an unknown type and a bad email', () => {
    expect(() => validateJob({ ...otpJob, type: 'EMAIL_SMS' })).toThrow('Invalid notification envelope');
    expect(() => validateJob({ ...otpJob, to: 'not-an-email' })).toThrow('Invalid notification envelope');
  });

  it('rejects a ticket job without booking_id and an OTP with a bad code', () => {
    expect(() => validateJob({ ...ticketJob, booking_id: undefined })).toThrow('Invalid notification envelope');
    expect(() => validateJob({ ...otpJob, variables: { code: '12345' } })).toThrow('Invalid EMAIL_OTP variables');
  });

  it('rejects a ticket job with no tickets', () => {
    const bad = { ...ticketJob, variables: { ...ticketJob.variables, tickets: [] } };
    expect(() => validateJob(bad)).toThrow('Invalid EMAIL_TICKET variables');
  });
});

describe('renderEmail', () => {
  it('renders OTP with the code and expiry, never shared', () => {
    const { subject, text, html } = renderEmail(validateJob(otpJob));
    expect(subject).toContain('Kode verifikasi');
    expect(text).toContain('123456');
    expect(text).toContain('10 menit');
    expect(text).toContain('Jangan bagikan');
    expect(html).toContain('123456');
  });

  it('renders a ticket with event, masked NIK and ticket code', () => {
    const { subject, text } = renderEmail(validateJob(ticketJob), { download_links: ['https://s3.example/dl'] });
    expect(subject).toContain('Konser Rusuh');
    expect(text).toContain('SMD-FB-04827');
    expect(text).toContain('3171****0001');
    expect(text).toContain('https://s3.example/dl');
    expect(text).not.toContain('3171010101900001');
  });

  it('renders expired with the D11 notice and admin email', () => {
    const { text } = renderEmail(validateJob(expiredJob), { admin_email: 'admin@rusuh-tiket.web.id' });
    expect(text).toContain('10 menit');
    expect(text).toContain('tidak ada tagihan');
    expect(text).toContain('Jika saldo Anda sudah terpotong');
    expect(text).toContain('admin@rusuh-tiket.web.id');
    expect(text).not.toContain('merasa');
  });
});

describe('decideClaim', () => {
  const staleMs = 5 * 60 * 1000;
  it('sent -> duplicate', () => {
    expect(decideClaim({ status: 'sent', updated_at: new Date().toISOString() }, staleMs, Date.now())).toBe(
      'duplicate'
    );
  });
  it('sending fresh -> in-flight, sending stale -> claimed, failed -> claimed', () => {
    const now = Date.now();
    expect(decideClaim({ status: 'sending', updated_at: new Date(now - 60 * 1000).toISOString() }, staleMs, now)).toBe(
      'in-flight'
    );
    expect(
      decideClaim({ status: 'sending', updated_at: new Date(now - 6 * 60 * 1000).toISOString() }, staleMs, now)
    ).toBe('claimed');
    expect(decideClaim({ status: 'failed', updated_at: new Date(now).toISOString() }, staleMs, now)).toBe('claimed');
  });
});

describe('memory email_log store', () => {
  it('claims, dedups sent, skips in-flight, reclaims stale', async () => {
    let now = Date.now();
    const store = createMemoryEmailLogStore({ staleMinutes: 5, now: () => now });
    expect((await store.claim({ bookingId: 'b1', type: 'EMAIL_TICKET' })).outcome).toBe('claimed');
    expect((await store.claim({ bookingId: 'b1', type: 'EMAIL_TICKET' })).outcome).toBe('in-flight');
    await store.markSent({ bookingId: 'b1', type: 'EMAIL_TICKET', sesMessageId: 'ses-1' });
    expect((await store.claim({ bookingId: 'b1', type: 'EMAIL_TICKET' })).outcome).toBe('duplicate');
    await store.markFailed({ bookingId: 'b1', type: 'EMAIL_TICKET' });
    expect((await store.claim({ bookingId: 'b1', type: 'EMAIL_TICKET' })).outcome).toBe('claimed');
    now += 6 * 60 * 1000;
    expect((await store.claim({ bookingId: 'b1', type: 'EMAIL_TICKET' })).outcome).toBe('claimed');
  });

  it('keeps TICKET and EXPIRED separate per booking', async () => {
    const store = createMemoryEmailLogStore({});
    await store.claim({ bookingId: 'b1', type: 'EMAIL_TICKET' });
    expect((await store.claim({ bookingId: 'b1', type: 'EMAIL_EXPIRED' })).outcome).toBe('claimed');
  });
});

describe('buildMimeMessage', () => {
  it('builds a multipart message with an attachment', () => {
    const raw = buildMimeMessage({
      from: 'noreply@rusuh-tiket.web.id',
      to: 'user@example.id',
      subject: 'E-tiket',
      text: 'Tiket Anda',
      html: '<p>Tiket Anda</p>',
      attachments: [{ filename: 'tiket.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4') }]
    });
    const text = raw.toString('utf8');
    expect(text).toContain('Content-Type: multipart/mixed');
    expect(text).toContain('Tiket Anda');
    expect(text).toContain('Content-Type: application/pdf; name="tiket.pdf"');
    expect(text).toContain(Buffer.from('%PDF-1.4').toString('base64'));
  });
});

describe('createEmailSender', () => {
  it('sends plain email via SES and retries a transient failure once', async () => {
    const ses = { sendEmail: jest.fn().mockRejectedValueOnce(new Error('Throttling')).mockResolvedValueOnce('ses-9') };
    const sender = createEmailSender({
      ses,
      from: 'noreply@rusuh-tiket.web.id',
      limiter: { acquire: async () => {} },
      sleep: async () => {}
    });
    const id = await sender.send({ to: 'user@example.id', subject: 'OTP', text: '123456' });
    expect(id).toBe('ses-9');
    expect(ses.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('uses raw email when attachments are present and throws after max attempts', async () => {
    const ses = { sendRawEmail: jest.fn().mockRejectedValue(new Error('SES down')) };
    const sender = createEmailSender({
      ses,
      from: 'noreply@rusuh-tiket.web.id',
      maxAttempts: 2,
      limiter: { acquire: async () => {} },
      sleep: async () => {}
    });
    await expect(
      sender.send({
        to: 'user@example.id',
        subject: 'Tiket',
        text: 'x',
        attachments: [{ filename: 't.pdf', contentType: 'application/pdf', data: Buffer.from('x') }]
      })
    ).rejects.toThrow('SES down');
    expect(ses.sendRawEmail).toHaveBeenCalledTimes(2);
  });

  it('enforces the rate limit before sending', async () => {
    const ses = { sendEmail: jest.fn(async () => 'ses-1') };
    const limiter = { acquire: jest.fn(async () => {}) };
    const sender = createEmailSender({ ses, from: 'noreply@rusuh-tiket.web.id', limiter, sleep: async () => {} });
    await sender.send({ to: 'user@example.id', subject: 'OTP', text: '123456' });
    expect(limiter.acquire).toHaveBeenCalledTimes(1);
  });
});

describe('createEmailUseCase', () => {
  const config = { adminEmail: 'admin@rusuh-tiket.web.id', s3: { ticketBucket: 'rusuh-tickets' } };
  const logger = { addTags: () => logger, addData: () => logger, info: () => {}, error: () => {} };

  it('sends an OTP job without touching email_log', async () => {
    const logStore = createMemoryEmailLogStore({});
    const sender = { send: jest.fn(async () => 'ses-otp') };
    const processor = createEmailUseCase({ logStore, sender, s3: {}, config, logger });
    const result = await processor.process(otpJob);
    expect(result).toEqual({ outcome: 'sent', sesMessageId: 'ses-otp' });
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.id' }));
    expect(logStore._rows.size).toBe(0);
  });

  it('returns invalid for a malformed job (no send, no claim)', async () => {
    const logStore = createMemoryEmailLogStore({});
    const sender = { send: jest.fn() };
    const processor = createEmailUseCase({ logStore, sender, s3: {}, config, logger });
    const result = await processor.process({ type: 'EMAIL_OTP', to: 'bad', variables: {} });
    expect(result.outcome).toBe('invalid');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('dedups a ticket job that was already sent', async () => {
    const logStore = createMemoryEmailLogStore({});
    await logStore.claim({ bookingId: 'bk_01', type: 'EMAIL_TICKET' });
    await logStore.markSent({ bookingId: 'bk_01', type: 'EMAIL_TICKET', sesMessageId: 'ses-1' });
    const sender = { send: jest.fn() };
    const processor = createEmailUseCase({ logStore, sender, s3: {}, config, logger });
    const result = await processor.process(ticketJob);
    expect(result.outcome).toBe('duplicate');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('skips a ticket job another worker is sending', async () => {
    const logStore = createMemoryEmailLogStore({});
    await logStore.claim({ bookingId: 'bk_01', type: 'EMAIL_TICKET' });
    const sender = { send: jest.fn() };
    const processor = createEmailUseCase({ logStore, sender, s3: {}, config, logger });
    expect((await processor.process(ticketJob)).outcome).toBe('skipped');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('sends a ticket with the PDF attached and a presigned download link', async () => {
    const logStore = createMemoryEmailLogStore({});
    const sender = { send: jest.fn(async () => 'ses-ticket') };
    const s3 = {
      getObject: jest.fn(async () => Buffer.from('%PDF-1.4')),
      presignedGetUrl: jest.fn(async () => 'https://s3.example/dl/bk_01')
    };
    const processor = createEmailUseCase({ logStore, sender, s3, config, logger });
    const result = await processor.process(ticketJob);
    expect(result).toEqual({ outcome: 'sent', sesMessageId: 'ses-ticket' });
    expect(s3.getObject).toHaveBeenCalledWith('rusuh-tickets', 'tickets/bk_01/SMD-FB-04827.pdf');
    const sent = sender.send.mock.calls[0][0];
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].filename).toBe('SMD-FB-04827.pdf');
    expect(sent.text).toContain('https://s3.example/dl/bk_01');
    const row = logStore._rows.get('bk_01:TICKET');
    expect(row.status).toBe('sent');
    expect(row.ses_message_id).toBe('ses-ticket');
  });

  it('fails (no send, no attachment) when the PDF cannot be fetched', async () => {
    const logStore = createMemoryEmailLogStore({});
    const sender = { send: jest.fn() };
    const s3 = {
      getObject: jest.fn(async () => {
        throw new Error('NoSuchKey');
      }),
      presignedGetUrl: jest.fn()
    };
    const processor = createEmailUseCase({ logStore, sender, s3, config, logger });
    const result = await processor.process(ticketJob);
    expect(result.outcome).toBe('failed');
    expect(sender.send).not.toHaveBeenCalled();
    expect(logStore._rows.get('bk_01:TICKET').status).toBe('failed');
  });

  it('sends an expired email with the D11 notice and marks it sent', async () => {
    const logStore = createMemoryEmailLogStore({});
    const sender = { send: jest.fn(async () => 'ses-exp') };
    const processor = createEmailUseCase({ logStore, sender, s3: {}, config, logger });
    const result = await processor.process(expiredJob);
    expect(result).toEqual({ outcome: 'sent', sesMessageId: 'ses-exp' });
    const sent = sender.send.mock.calls[0][0];
    expect(sent.text).toContain('Jika saldo Anda sudah terpotong');
    expect(sent.text).toContain('admin@rusuh-tiket.web.id');
    expect(logStore._rows.get('bk_02:EXPIRED').status).toBe('sent');
  });

  it('marks failed and returns failed when SES throws', async () => {
    const logStore = createMemoryEmailLogStore({});
    const sender = {
      send: jest.fn(async () => {
        throw new Error('SES 500');
      })
    };
    const processor = createEmailUseCase({ logStore, sender, s3: {}, config, logger });
    const result = await processor.process(expiredJob);
    expect(result.outcome).toBe('failed');
    expect(logStore._rows.get('bk_02:EXPIRED').status).toBe('failed');
  });
});
