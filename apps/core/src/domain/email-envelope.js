/**
 * E-mail envelope builders for the notification-module contract
 * (LLD-04 §3 + rusuh-web#46). Every variable is PRE-FORMATTED here — the
 * templates do no formatting. Formats follow the design brief:
 *   id: "Sab, 12 Des 2026" · "19.00 WIB" · "Rp 3.015.000"
 *   en: "Sat, 12 Dec 2026" · "7.00 pm WIB" · "Rp 3,015,000"
 * The envelope shape must match notification-module's Joi validation
 * EXACTLY (unknown(false)): {type, to, locale, booking_id?, variables,
 * attachments?} — no extra keys.
 */

const WIB = 'Asia/Jakarta';

/**
 * Formats a date as the brief's short form (id "Sab, 12 Des 2026").
 *
 * @param {Date|string} date - Date to format.
 * @param {string} locale - 'id' | 'en'.
 * @returns {string} Formatted date.
 */
function formatEventDate(date, locale) {
  const parts = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'id-ID', {
    timeZone: WIB,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).formatToParts(new Date(date));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')}`;
}

/**
 * Formats a time of day as a WIB clock time (id "19.00 WIB", en "7.00 pm WIB").
 * The brief uses dot-separated clock times; Intl emits colons, so they are
 * replaced (en-GB gives the 12-hour "7:00 pm" form).
 *
 * @param {Date|string} date - Date to format.
 * @param {string} locale - 'id' | 'en'.
 * @returns {string} Formatted clock time.
 */
function formatWibClock(date, locale) {
  if (locale === 'en') {
    const en = new Intl.DateTimeFormat('en-GB', { timeZone: WIB, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(new Date(date))
      .replace(':', '.');
    return `${en} WIB`;
  }
  const id = new Intl.DateTimeFormat('id-ID', { timeZone: WIB, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(date))
    .replace(':', '.');
  return `${id} WIB`;
}

/**
 * Formats a timestamp as "date, clock" (e.g. paid_at / deadline fields).
 *
 * @param {Date|string} date - Date to format.
 * @param {string} locale - 'id' | 'en'.
 * @returns {string} "Sab, 12 Des 2026, 19.00 WIB".
 */
function formatDateTime(date, locale) {
  return `${formatEventDate(date, locale)}, ${formatWibClock(date, locale)}`;
}

/**
 * Formats an integer IDR amount (id "Rp 3.015.000", en "Rp 3,015,000").
 *
 * @param {number} amount - Integer IDR.
 * @param {string} locale - 'id' | 'en'.
 * @returns {string} Formatted amount.
 */
function formatIdr(amount, locale) {
  const grouped = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'id-ID').format(amount || 0);
  return `Rp ${grouped}`;
}

/** Midtrans payment types -> human labels (rusuh-web#46 pre-formatting). */
const PAYMENT_METHOD_LABELS = {
  bank_transfer: { id: 'Transfer bank', en: 'Bank transfer' },
  credit_card: { id: 'Kartu kredit', en: 'Credit card' },
  qris: { id: 'QRIS', en: 'QRIS' },
  gopay: { id: 'GoPay', en: 'GoPay' },
  shopeepay: { id: 'ShopeePay', en: 'ShopeePay' },
  dana: { id: 'DANA', en: 'DANA' },
  ovo: { id: 'OVO', en: 'OVO' },
  cstore: { id: 'Toko ritel', en: 'Retail store' }
};

/**
 * Human label for a Midtrans payment type; unknown types are humanized
 * ("bca_va" -> "bca va") rather than dropped.
 *
 * @param {string} paymentType - Midtrans payment_type.
 * @param {string} locale - 'id' | 'en'.
 * @returns {string} Label.
 */
function paymentMethodLabel(paymentType, locale) {
  if (!paymentType) return locale === 'en' ? 'Not recorded' : 'Tidak tercatat';
  const entry = PAYMENT_METHOD_LABELS[paymentType];
  if (entry) return locale === 'en' ? entry.en : entry.id;
  return String(paymentType).replace(/_/g, ' ');
}

/**
 * Builds the EMAIL_TICKET envelope (rusuh-web#46 "ticket" variables).
 *
 * @param {object} input
 * @param {{email: string, locale?: string}} input.account - Buyer (from auth-module).
 * @param {object} input.booking - PAID booking (paidAt, paymentMethod, price).
 * @param {object} [input.event] - Event row (name, subtitle, venue, startsAt, doorsOpenAt).
 * @param {Array<object>} input.tickets - Minted ticket rows (categoryName, holderName,
 *   nikMasked, ticketCode, entryGate).
 * @param {{ticketUrl: string, downloadAllUrl: string}} input.links - Web ticket-page links.
 * @returns {object} Notification envelope.
 */
function buildTicketEnvelope({ account, booking, event, tickets, links }) {
  const locale = account.locale || 'id';
  const startsAt = event && event.startsAt;
  return {
    type: 'EMAIL_TICKET',
    to: account.email,
    locale,
    booking_id: booking.bookingId,
    variables: {
      event_name: (event && event.name) || '',
      event_subtitle: (event && event.subtitle) || '',
      event_date: startsAt ? formatEventDate(startsAt, locale) : '',
      event_time: startsAt ? formatWibClock(startsAt, locale) : '',
      venue: (event && event.venue) || '',
      doors_open_at: event && event.doorsOpenAt ? formatWibClock(event.doorsOpenAt, locale) : '',
      order_code: booking.orderCode,
      total: formatIdr(booking.price.total.amount, locale),
      payment_method: paymentMethodLabel(booking.paymentMethod, locale),
      paid_at: booking.paidAt ? formatDateTime(booking.paidAt, locale) : '',
      count: tickets.length,
      ticket_url: links.ticketUrl,
      download_all_url: links.downloadAllUrl,
      email: account.email,
      tickets: tickets.map((ticket, index) => ({
        index: index + 1,
        category: ticket.categoryName,
        holder_name: ticket.holderName,
        nik_masked: ticket.nikMasked,
        ticket_code: ticket.ticketCode,
        gate: ticket.entryGate || ''
      }))
    }
  };
}

/**
 * Builds the EMAIL_EXPIRED envelope (payment deadline missed, FR-23).
 *
 * @param {object} input
 * @param {{email: string, locale?: string}} input.account - Buyer.
 * @param {object} input.booking - EXPIRED booking (paymentExpiresAt = deadline).
 * @param {object} [input.event] - Event row.
 * @param {{eventUrl: string}} input.links - Queue-again link (web /queue?event=).
 * @returns {object} Notification envelope.
 */
function buildExpiredEnvelope({ account, booking, event, links }) {
  const locale = account.locale || 'id';
  return {
    type: 'EMAIL_EXPIRED',
    to: account.email,
    locale,
    booking_id: booking.bookingId,
    variables: {
      event_name: (event && event.name) || '',
      order_code: booking.orderCode,
      total: formatIdr(booking.price.total.amount, locale),
      deadline: booking.paymentExpiresAt ? formatDateTime(booking.paymentExpiresAt, locale) : '',
      email: account.email,
      event_url: links.eventUrl
    }
  };
}

/**
 * Builds the EMAIL_REFUND_FLAGGED envelope (ADR-0009 late payment, D11:
 * a late settlement never resurrects the booking; the money is returned).
 *
 * @param {object} input
 * @param {{email: string, locale?: string}} input.account - Buyer.
 * @param {object} input.booking - EXPIRED/CANCELLED booking (paymentExpiresAt = deadline).
 * @param {object} [input.event] - Event row.
 * @param {string} input.transactionId - Midtrans transaction id.
 * @param {string} input.paymentType - Midtrans payment_type.
 * @param {Date|string} input.paidAt - Settlement timestamp.
 * @param {{id: string, en: string}} input.refundWindowLabel - Finance refund-window
 *   text per language (rusuh-web#46: sample "14 hari kerja", to confirm).
 * @returns {object} Notification envelope.
 */
function buildRefundFlaggedEnvelope({
  account,
  booking,
  event,
  transactionId,
  paymentType,
  paidAt,
  refundWindowLabel
}) {
  const locale = account.locale || 'id';
  return {
    type: 'EMAIL_REFUND_FLAGGED',
    to: account.email,
    locale,
    booking_id: booking.bookingId,
    variables: {
      event_name: (event && event.name) || '',
      order_code: booking.orderCode,
      total: formatIdr(booking.price.total.amount, locale),
      payment_method: paymentMethodLabel(paymentType, locale),
      paid_at: formatDateTime(paidAt, locale),
      deadline: booking.paymentExpiresAt ? formatDateTime(booking.paymentExpiresAt, locale) : '',
      refund_window: (refundWindowLabel && refundWindowLabel[locale]) || '',
      transaction_id: transactionId || '',
      email: account.email
    }
  };
}

module.exports = {
  formatEventDate,
  formatWibClock,
  formatDateTime,
  formatIdr,
  paymentMethodLabel,
  buildTicketEnvelope,
  buildExpiredEnvelope,
  buildRefundFlaggedEnvelope
};
