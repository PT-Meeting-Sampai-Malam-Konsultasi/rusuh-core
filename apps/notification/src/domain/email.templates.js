/**
 * Email templates (LLD-04 §5). Indonesian by default; final copy needs a
 * team/copy review. The OTP code is rendered into the body but NEVER logged.
 */

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderOtp({ code, expires_in: expiresIn }) {
  const subject = 'Kode verifikasi Rusuh Anda';
  const text =
    `Kode verifikasi Anda adalah ${code}.\n\n` +
    `Kode berlaku ${expiresIn} menit. Jangan bagikan kode ini kepada siapa pun.\n\n` +
    `Jika Anda tidak meminta kode ini, abaikan email ini.`;
  const html =
    `<p>Kode verifikasi Anda adalah <strong>${escapeHtml(code)}</strong>.</p>` +
    `<p>Kode berlaku ${expiresIn} menit. Jangan bagikan kode ini kepada siapa pun.</p>` +
    `<p>Jika Anda tidak meminta kode ini, abaikan email ini.</p>`;
  return { subject, text, html };
}

function renderTicket({
  event_name: eventName,
  event_date: eventDate,
  venue,
  doors_open_at: doorsOpenAt,
  tickets,
  download_all_url: downloadAllUrl,
  download_links: downloadLinks = []
}) {
  const subject = `E-tiket Anda — ${eventName}`;
  const lines = tickets.map((ticket, index) => {
    const link = downloadLinks[index] ? `\n  Unduh: ${downloadLinks[index]}` : '';
    return (
      `- Tiket ${index + 1}: ${ticket.category}\n` +
      `  Kode tiket: ${ticket.ticket_code}\n` +
      `  NIK: ${ticket.nik_masked}${ticket.gate ? `\n  Gerbang: ${ticket.gate}` : ''}${link}`
    );
  });
  const text =
    `E-tiket Anda untuk ${eventName} sudah terbit.\n\n` +
    `Tanggal: ${eventDate}\n` +
    `Tempat: ${venue}\n` +
    `${doorsOpenAt ? `Pintu dibuka: ${doorsOpenAt}\n` : ''}\n` +
    `${lines.join('\n')}\n\n` +
    `${downloadAllUrl ? `Unduh semua (PDF): ${downloadAllUrl}\n\n` : ''}` +
    `Tunjukkan kode tiket (atau QR di PDF) di pintu masuk. Selamat menonton!`;
  const rows = tickets
    .map(
      (ticket, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(ticket.category)}</td><td>${escapeHtml(ticket.ticket_code)}</td>` +
        `<td>${escapeHtml(ticket.nik_masked)}</td><td>${escapeHtml(ticket.gate || '-')}</td>` +
        `<td>${downloadLinks[index] ? `<a href="${escapeHtml(downloadLinks[index])}">Unduh</a>` : '-'}</td></tr>`
    )
    .join('');
  const html =
    `<p>E-tiket Anda untuk <strong>${escapeHtml(eventName)}</strong> sudah terbit.</p>` +
    `<p>Tanggal: ${escapeHtml(eventDate)}<br>Tempat: ${escapeHtml(venue)}` +
    `${doorsOpenAt ? `<br>Pintu dibuka: ${escapeHtml(doorsOpenAt)}` : ''}</p>` +
    `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>` +
    `<th>#</th><th>Kategori</th><th>Kode tiket</th><th>NIK</th><th>Gerbang</th><th>PDF</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    `${downloadAllUrl ? `<p><a href="${escapeHtml(downloadAllUrl)}">Unduh semua (PDF)</a></p>` : ''}` +
    `<p>Tunjukkan kode tiket (atau QR di PDF) di pintu masuk. Selamat menonton!</p>`;
  return { subject, text, html };
}

function renderExpired({ event_name: eventName, booking_id: bookingId, admin_email: adminEmail }) {
  const subject = `Pembayaran ${eventName} dibatalkan`;
  const text =
    `Pembayaran Anda untuk ${eventName} (booking ${bookingId}) dibatalkan karena ` +
    `pembayaran tidak selesai dalam 10 menit. Stok tiket Anda sudah dilepas dan ` +
    `tidak ada tagihan atas booking ini.\n\n` +
    `Jika saldo Anda sudah terpotong, hubungi admin melalui email ${adminEmail} ` +
    `dengan melampirkan bukti transfer.`;
  const html =
    `<p>Pembayaran Anda untuk <strong>${escapeHtml(eventName)}</strong> (booking ${escapeHtml(bookingId)}) ` +
    `dibatalkan karena pembayaran tidak selesai dalam 10 menit. Stok tiket Anda sudah dilepas dan ` +
    `tidak ada tagihan atas booking ini.</p>` +
    `<p>Jika saldo Anda sudah terpotong, hubungi admin melalui email ` +
    `<a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a> dengan melampirkan bukti transfer.</p>`;
  return { subject, text, html };
}

const renderers = { EMAIL_OTP: renderOtp, EMAIL_TICKET: renderTicket, EMAIL_EXPIRED: renderExpired };

/**
 * Renders an email for a validated job.
 *
 * @param {object} job - Validated job (type + variables).
 * @param {object} [extra] - Extra variables merged into the template input.
 * @returns {object} {subject, text, html}.
 */
function renderEmail(job, extra = {}) {
  const renderer = renderers[job.type];
  if (!renderer) throw new Error(`No template for type ${job.type}`);
  return renderer({ ...job.variables, ...extra });
}

module.exports = { renderEmail, renderOtp, renderTicket, renderExpired };
