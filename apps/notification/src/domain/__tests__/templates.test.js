const { renderEmail, renderOtp, renderTicket, renderExpired } = require('../email.templates');

describe('renderTicket', () => {
  const base = {
    event_name: 'Konser Rusuh',
    event_date: '2026-11-13',
    venue: 'GOR Jakarta',
    tickets: [{ category: 'VIP', gate: 'A', nik_masked: '3171****0001', ticket_code: 'SMD-FB-04827' }]
  };

  it('renders without optional fields (no gate, no doors, no download links)', () => {
    const ticket = {
      ...base,
      tickets: [{ category: 'Reguler', nik_masked: '3171****0002', ticket_code: 'SMD-RG-00001' }]
    };
    const { text, html } = renderTicket(ticket);
    expect(text).toContain('Reguler');
    expect(text).toContain('SMD-RG-00001');
    expect(text).not.toContain('Gerbang');
    expect(text).not.toContain('Pintu dibuka');
    expect(text).not.toContain('Unduh');
    expect(html).toContain('<td>-</td>');
  });

  it('renders with gate, doors, download links and a download-all URL', () => {
    const { text, html } = renderTicket({
      ...base,
      doors_open_at: '18:00',
      download_all_url: 'https://s3.example/all.pdf',
      download_links: ['https://s3.example/dl/1.pdf']
    });
    expect(text).toContain('Gerbang: A');
    expect(text).toContain('Pintu dibuka: 18:00');
    expect(text).toContain('Unduh: https://s3.example/dl/1.pdf');
    expect(text).toContain('Unduh semua (PDF): https://s3.example/all.pdf');
    expect(html).toContain('Pintu dibuka: 18:00');
    expect(html).toContain('<a href="https://s3.example/dl/1.pdf">Unduh</a>');
    expect(html).toContain('Unduh semua (PDF)');
  });

  it('escapes HTML in every field', () => {
    const { html } = renderTicket({
      ...base,
      event_name: 'Konser <b>Rusuh</b> & "Friends"',
      venue: 'GOR <Jakarta>',
      tickets: [{ category: 'VIP <script>', gate: 'A&B', nik_masked: '3171****0001', ticket_code: 'SMD-"X"-1' }]
    });
    expect(html).toContain('&lt;b&gt;Rusuh&lt;/b&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<script>');
  });

  it('renders several tickets with per-ticket links', () => {
    const { text } = renderTicket({
      ...base,
      tickets: [
        { category: 'VIP', gate: 'A', nik_masked: '3171****0001', ticket_code: 'SMD-FB-04827' },
        { category: 'Reguler', nik_masked: '3171****0002', ticket_code: 'SMD-RG-00001' }
      ],
      download_links: ['https://s3.example/dl/1.pdf']
    });
    expect(text).toContain('Tiket 1: VIP');
    expect(text).toContain('Tiket 2: Reguler');
    expect(text).toContain('Unduh: https://s3.example/dl/1.pdf');
  });
});

describe('renderOtp / renderExpired / renderEmail', () => {
  it('renders OTP and escapes the code in HTML', () => {
    const { text, html } = renderOtp({ code: '123456', expires_in: 10 });
    expect(text).toContain('123456');
    expect(html).toContain('<strong>123456</strong>');
  });

  it('renders the expired notice with the admin email escaped', () => {
    const { text, html } = renderExpired({
      event_name: 'Konser <Rusuh>',
      booking_id: 'bk_02',
      admin_email: 'admin@rusuh-tiket.web.id'
    });
    expect(text).toContain('Jika saldo Anda sudah terpotong');
    expect(text).toContain('admin@rusuh-tiket.web.id');
    expect(html).toContain('&lt;Rusuh&gt;');
    expect(html).toContain('mailto:admin@rusuh-tiket.web.id');
  });

  it('renderEmail throws for an unknown type', () => {
    expect(() => renderEmail({ type: 'EMAIL_SMS', variables: {} })).toThrow('No template for type EMAIL_SMS');
  });

  it('renderEmail dispatches by type', () => {
    const { subject } = renderEmail({ type: 'EMAIL_OTP', variables: { code: '123456', expires_in: 10 } });
    expect(subject).toContain('Kode verifikasi');
  });
});
