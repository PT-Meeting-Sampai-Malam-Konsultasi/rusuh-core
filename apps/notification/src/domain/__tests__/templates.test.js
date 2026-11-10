const { renderEmail } = require('../email.templates');

const otpVars = {
  code: '482019',
  code_spaced: '482&nbsp;019',
  expires_at: '21.30 WIB',
  email: 'rina@example.id'
};

const ticketVars = {
  event_name: 'Konser Rusuh',
  event_subtitle: 'Tour Terakhir',
  event_date: 'Sab, 12 Des 2026',
  event_time: '19.00 WIB',
  venue: 'GOR Jakarta',
  doors_open_at: '18.00 WIB',
  order_code: 'RSH-ORDER-77',
  total: 'Rp 3.015.000',
  payment_method: 'QRIS',
  paid_at: 'Sab, 12 Des 2026 19.05 WIB',
  count: 2,
  email: 'rina@example.id',
  ticket_url: 'https://rusuh.id/tickets/RSH-ORDER-77',
  download_all_url: 'https://rusuh.id/tickets/RSH-ORDER-77.pdf',
  tickets: [
    {
      index: 1,
      category: 'VIP',
      holder_name: 'Rina',
      nik_masked: '3174 •••• •••• 0004',
      ticket_code: 'RSH-VIP-0001',
      gate: 'A'
    },
    {
      index: 2,
      category: 'Festival',
      holder_name: 'Budi',
      nik_masked: '3174 •••• •••• 0005',
      ticket_code: 'RSH-FES-0002',
      gate: 'B'
    }
  ]
};

const expiredVars = {
  event_name: 'Konser Rusuh',
  order_code: 'RSH-ORDER-78',
  total: 'Rp 1.515.000',
  deadline: 'Sab, 12 Des 2026 19.10 WIB',
  email: 'rina@example.id',
  event_url: 'https://rusuh.id/queue?event=evt_1'
};

const refundVars = {
  event_name: 'Konser Rusuh',
  order_code: 'RSH-ORDER-79',
  total: 'Rp 1.515.000',
  payment_method: 'QRIS',
  paid_at: 'Sab, 12 Des 2026 19.12 WIB',
  deadline: 'Sab, 12 Des 2026 19.10 WIB',
  refund_window: '14 hari kerja',
  transaction_id: 'midtrans-tx-99',
  email: 'rina@example.id'
};

const job = (type, variables, locale) => ({ type, to: 'rina@example.id', ...(locale ? { locale } : {}), variables });

describe('renderEmail subjects (id + en)', () => {
  it.each([
    ['EMAIL_OTP', otpVars, '482019 adalah kode masuk Rusuh Anda', '482019 is your Rusuh sign-in code'],
    ['EMAIL_TICKET', ticketVars, 'E-tiket Anda: Konser Rusuh', 'Your e-tickets: Konser Rusuh'],
    [
      'EMAIL_EXPIRED',
      expiredVars,
      'Pesanan Konser Rusuh dibatalkan — tidak ada tagihan',
      'Your Konser Rusuh order was cancelled — no charge'
    ],
    [
      'EMAIL_REFUND_FLAGGED',
      refundVars,
      'Pembayaran Konser Rusuh terlambat — uang Anda akan kami kembalikan',
      "Your Konser Rusuh payment arrived late — we'll refund it"
    ]
  ])('%s renders the designed subject in both languages', (type, vars, idSubject, enSubject) => {
    expect(renderEmail(job(type, vars, 'id')).subject).toBe(idSubject);
    expect(renderEmail(job(type, vars, 'en')).subject).toBe(enSubject);
  });
});

describe('renderEmail locale handling', () => {
  it('defaults to Indonesian when locale is missing', () => {
    const { text } = renderEmail(job('EMAIL_OTP', otpVars));
    expect(text).toContain('Berlaku 10 menit');
  });

  it('falls back to Indonesian for an unknown locale', () => {
    const { text } = renderEmail(job('EMAIL_OTP', otpVars, 'fr'));
    expect(text).toContain('Berlaku 10 menit');
  });
});

describe('renderEmail escaping', () => {
  it('escapes HTML in the html part but keeps text raw', () => {
    const vars = { ...otpVars, expires_at: '21.<b>30&"WIB' };
    const { text, html } = renderEmail(job('EMAIL_OTP', vars, 'id'));
    expect(text).toContain('21.<b>30&"WIB');
    expect(html).toContain('21.&lt;b&gt;30&amp;&quot;WIB');
    expect(html).not.toContain('21.<b>30&"WIB');
  });
});

describe('renderEmail tickets section', () => {
  it('renders every ticket row in text and html', () => {
    const { text, html } = renderEmail(job('EMAIL_TICKET', ticketVars, 'id'));
    expect(text).toContain('RSH-VIP-0001');
    expect(text).toContain('RSH-FES-0002');
    expect(html).toContain('RSH-VIP-0001');
    expect(html).toContain('RSH-FES-0002');
    expect(html).toContain('Tiket 2 dari 2');
  });
});

describe('renderEmail missing variables and unknown types', () => {
  it('renders a missing variable as an empty string', () => {
    const { text, html } = renderEmail(
      job('EMAIL_OTP', { code: '482019', expires_at: '21.30 WIB', email: 'x@example.id' })
    );
    expect(text).not.toContain('{{');
    expect(html).not.toContain('{{');
    expect(text).not.toContain('undefined');
  });

  it('throws for an unknown job type', () => {
    expect(() => renderEmail(job('EMAIL_NOPE', {}))).toThrow('No template for type EMAIL_NOPE');
  });
});

describe('renderEmail refund template (both languages)', () => {
  it('renders the refund window and transaction id', () => {
    const id = renderEmail(job('EMAIL_REFUND_FLAGGED', refundVars, 'id'));
    const en = renderEmail(job('EMAIL_REFUND_FLAGGED', refundVars, 'en'));
    expect(id.text).toContain('14 hari kerja');
    expect(id.text).toContain('midtrans-tx-99');
    expect(en.text).toContain('14 hari kerja');
    expect(en.text).toContain('midtrans-tx-99');
  });
});
