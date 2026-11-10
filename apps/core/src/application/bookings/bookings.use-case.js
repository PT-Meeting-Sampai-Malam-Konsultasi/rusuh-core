const { problemError } = require('@/domain/problem');
const { computePrice } = require('@/domain/fees');
const { generateBookingId, generateTicketId, generateOrderCode, ticketCode, qrPayload } = require('@/domain/ids');
const { encryptNik } = require('@/domain/nik');
const { verifyValidationToken } = require('@/domain/validation-token');
const { serverNow } = require('@/domain/presenters');
const { buildTicketEnvelope, buildExpiredEnvelope, buildRefundFlaggedEnvelope } = require('@/domain/email-envelope');
const { MAX_SEATS_PER_NIK, MAX_TICKETS_PER_ORDER } = require('@rusuh/contracts').constants;

const SELECTION_TTL_MS = 5 * 60 * 1000;
const PAYMENT_TTL_MS = 10 * 60 * 1000;

/**
 * Booking use case (LLD-02 §5–§7, §10–§11).
 * States: SELECTION (5 min, no hold) -> PAYMENT_PENDING (10 min, hold)
 *   -> PAID / EXPIRED. A late successful callback NEVER resurrects (D11).
 *
 * @param {object} deps
 * @param {object} deps.store - StorePort (durable store: bookings, tickets, nik backstop).
 * @param {object} deps.stock - StockPort (live stock adapter: Lua hold/release/settle, admission).
 * @param {object} deps.payment - PaymentPort (payment-module internal client).
 * @param {object} deps.eventBus - EventBusPort (empty-slot, email jobs).
 * @param {object} deps.accounts - AuthPort (getAccount: buyer e-mail + locale
 *   for the e-mail envelopes, LLD-04 §3 `to` = account e-mail).
 * @param {object} deps.emailConfig - E-mail link/label config ({ webBaseUrl,
 *   refundWindowLabel } from the service config).
 * @param {Buffer} deps.nikEncryptionKey - 32-byte key for NIK ciphertext + tokens.
 * @param {string} deps.qrKey - HMAC key for the QR payload signature.
 * @param {object} deps.fees - Fee config ({ platformFee, adminFee, ppnRate, tax2Rate, tax2Base, tax2Label }).
 * @param {Function} deps.mayAccessBooking - Booking-access guard, injected by
 *   the container from the presentation layer (auth middleware):
 *   (booking, caller) => boolean. The use case never imports presentation/.
 * @returns {object} Booking use case.
 */
function createBookingUseCase({
  store,
  stock,
  payment,
  eventBus,
  accounts,
  emailConfig,
  nikEncryptionKey,
  qrKey,
  fees,
  mayAccessBooking
}) {
  if (typeof mayAccessBooking !== 'function') {
    throw new Error('createBookingUseCase requires mayAccessBooking (injected by the container)');
  }
  if (!accounts || typeof accounts.getAccount !== 'function') {
    throw new Error('createBookingUseCase requires accounts (auth-module client, injected by the container)');
  }
  function luaItems(booking) {
    // Group tickets by category; collect the NIK HMACs per category.
    const byCategory = new Map();
    booking.attendees.forEach((attendee) => {
      const entry = byCategory.get(attendee.categoryId) || { categoryId: attendee.categoryId, qty: 0, nikHmacs: [] };
      entry.qty += 1;
      entry.nikHmacs.push(attendee.nikHmac);
      byCategory.set(attendee.categoryId, entry);
    });
    return [...byCategory.values()];
  }

  function orderIdFor(bookingId, attempt) {
    return `${bookingId}-${attempt}`;
  }

  async function releaseHold(booking) {
    await stock.release(booking.eventId, luaItems(booking));
  }

  async function settleHold(booking) {
    await stock.settle(booking.eventId, luaItems(booking));
  }

  async function publishEmptySlot(booking, reason) {
    return eventBus.publishEmptySlot({
      event_id: booking.eventId,
      released: booking.attendees.length,
      released_ids: [booking.bookingId],
      reason
    });
  }

  /**
   * Publishes one booking e-mail as a notification-module envelope
   * (LLD-04 §3). Best-effort AFTER the terminal transition (Point 6 /
   * NFR-10): an account-lookup or enqueue failure is logged, never thrown —
   * the booking flow must not fail because delivery failed. Dedup stays in
   * email_log (bookingId, type UNIQUE); a failed enqueue releases the claim
   * so a redelivered webhook can retry.
   *
   * @param {object} booking - Terminal booking (PAID / EXPIRED).
   * @param {Function} build - (account, event, links) => envelope.
   * @returns {Promise<boolean>} True when a job was enqueued.
   */
  async function enqueueBookingEmail(booking, build) {
    let account = null;
    try {
      account = await accounts.getAccount(booking.accountId);
    } catch (error) {
      console.error(`[core] account lookup for booking ${booking.bookingId} e-mail failed: ${error.message}`);
      return false;
    }
    if (!account || !account.email) {
      console.warn(`[core] no account e-mail for booking ${booking.bookingId}; e-mail skipped`);
      return false;
    }
    const event = await store.getEvent(booking.eventId);
    const links = {
      ticketUrl: `${emailConfig.webBaseUrl}/bookings/${booking.bookingId}`,
      downloadAllUrl: `${emailConfig.webBaseUrl}/bookings/${booking.bookingId}?download=all`,
      eventUrl: `${emailConfig.webBaseUrl}/queue?event=${booking.eventId}`
    };
    const envelope = build(account, event, links);

    const logged = await store.logEmail(booking.bookingId, envelope.type);
    if (!logged) return false; // dedup: (bookingId, type) UNIQUE
    try {
      await eventBus.sendEmailJob(envelope);
    } catch (error) {
      await store.releaseEmailLog(booking.bookingId, envelope.type);
      console.error(`[core] ${envelope.type} enqueue failed for booking ${booking.bookingId}: ${error.message}`);
      return false;
    }
    return true;
  }

  async function mintTickets(booking) {
    const event = await store.getEvent(booking.eventId);
    const eventCode = event?.eventCode || 'RSH';
    // Sequences are assigned in order (reduce, not Promise.all: nextTicketSeq
    // must not race for two tickets in the same category).
    const ticketRows = await booking.attendees.reduce(async (prevPromise, attendee) => {
      const rows = await prevPromise;
      const sequence = await store.nextTicketSeq(booking.eventId, attendee.categoryId);
      const code = ticketCode(eventCode, attendee.categoryCode || 'GEN', sequence);
      rows.push({
        ticketId: generateTicketId(),
        ticketCode: code,
        categoryId: attendee.categoryId,
        categoryName: attendee.categoryName,
        seating: attendee.seating,
        entryGate: attendee.entryGate,
        holderName: attendee.fullName,
        nikMasked: attendee.nikMasked,
        qrPayload: qrPayload(code, qrKey),
        sequence
      });
      return rows;
    }, Promise.resolve([]));
    return store.mintTickets(booking, ticketRows);
  }

  return {
    /**
     * Creates a SELECTION booking (5 min). Hold happens at payment entry (§6),
     * not here — this step only soft-checks stock/quota (best-effort read).
     */
    async createBooking(account, admission, { eventId, tickets }) {
      const event = await store.getEvent(eventId);
      if (!event) throw problemError('NOT_FOUND', 'No such resource for this caller.');

      // Idempotency (LLD-02 §5.1 step 3): the same admission returns its booking.
      const existing = await store.getActiveBookingByAdmission(admission.token);
      if (existing) return { booking: existing, created: false };
      const accountActive = await store.getActiveBookingByAccountEvent(account.sub, eventId);
      if (accountActive) {
        throw problemError('ACCOUNT_HAS_ACTIVE_BOOKING', 'Finish or cancel the active booking first.');
      }

      if (!Array.isArray(tickets) || tickets.length < 1 || tickets.length > MAX_TICKETS_PER_ORDER) {
        throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
      }
      if (tickets.length > admission.maxTickets) {
        throw problemError(
          'QUANTITY_OVER_RESERVATION',
          'You asked for more tickets than your admission allows (maximum 3 per order).'
        );
      }

      // Resolve each validation token (event match + not expired) + category.
      // Category lookups are independent (parallel); the duplicate-NIK check
      // below is sequential (sync) so it sees every earlier NIK.
      const resolved = await Promise.all(
        tickets.map(async (ticket) => {
          const category = await store.getCategory(eventId, ticket.categoryId);
          if (!category) throw problemError('NOT_FOUND', 'No such resource for this caller.');
          const attendee = verifyValidationToken(ticket.validationToken, nikEncryptionKey);
          if (!attendee || attendee.eventId !== eventId) {
            throw problemError('ATTENDEE_NOT_VALIDATED', 'Validate every attendee before holding the booking.');
          }
          return { category, attendee };
        })
      );
      const attendees = [];
      const seenNikHmacs = new Set();
      resolved.forEach(({ category, attendee }) => {
        if (seenNikHmacs.has(attendee.nikHmac)) {
          throw problemError('DUPLICATE_NIK', 'Each attendee in an order needs a different NIK.');
        }
        seenNikHmacs.add(attendee.nikHmac);
        attendees.push({
          categoryId: category.categoryId,
          categoryName: category.name,
          categoryCode: category.categoryCode,
          seating: category.seating,
          entryGate: category.entryGate,
          fullName: attendee.fullName,
          nik: attendee.nik,
          nikHmac: attendee.nikHmac,
          nikMasked: attendee.nikMasked,
          nikCiphertext: encryptNik(attendee.nik, nikEncryptionKey)
        });
      });

      // Soft check (best-effort; the hard check is the Lua hold at payment entry).
      const byCategory = new Map();
      attendees.forEach((attendee) => {
        byCategory.set(attendee.categoryId, (byCategory.get(attendee.categoryId) || 0) + 1);
      });
      await Promise.all(
        [...byCategory].map(async ([categoryId, qty]) => {
          const available = await stock.getAvailable(eventId, categoryId);
          if (available < qty) {
            throw problemError('CATEGORY_SOLD_OUT', 'Pick another category.', { categoryId });
          }
        })
      );
      await Promise.all(
        attendees.map(async (attendee) => {
          const live = await stock.getNikCount(eventId, attendee.nikHmac);
          const durable = await store.nikSeatCount(eventId, attendee.nikHmac);
          if (Math.max(live, durable) + 1 > MAX_SEATS_PER_NIK) {
            throw problemError('NIK_SEAT_TAKEN', 'This NIK already holds 3 seats for the event.', {
              nikMasked: attendee.nikMasked
            });
          }
        })
      );

      // Price (server-side, LLD-02 §8).
      const lines = [...byCategory.entries()].map(([categoryId, qty]) => {
        const attendee = attendees.find((a) => a.categoryId === categoryId);
        const category = { categoryId, name: attendee.categoryName };
        return { ...category, quantity: qty, unitPrice: 0 };
      });
      await Promise.all(
        lines.map(async (line) => {
          const category = await store.getCategory(eventId, line.categoryId);
          line.unitPrice = category.price;
        })
      );
      const price = computePrice(lines, fees);

      const now = Date.now();
      const booking = {
        bookingId: generateBookingId(),
        eventId,
        accountId: account.sub,
        admissionToken: admission.token,
        slotId: admission.slotId || null,
        status: 'SELECTION',
        expiresAt: new Date(now + SELECTION_TTL_MS).toISOString(),
        paymentExpiresAt: null,
        orderCode: generateOrderCode(),
        price,
        attendees: attendees.map((a) => ({
          categoryId: a.categoryId,
          categoryName: a.categoryName,
          categoryCode: a.categoryCode,
          seating: a.seating,
          entryGate: a.entryGate,
          fullName: a.fullName,
          nikHmac: a.nikHmac,
          nikMasked: a.nikMasked,
          nikCiphertext: a.nikCiphertext
        })),
        tickets: [],
        snapToken: null,
        paidAt: null,
        paymentMethod: null,
        refundRequired: false,
        attempt: 0
      };
      const stored = await store.createBooking(booking);
      return { booking: stored, created: true };
    },

    async getBooking(bookingId, caller) {
      const booking = await store.getBooking(bookingId);
      if (!booking) throw problemError('NOT_FOUND', 'No such resource for this caller.');
      if (caller && !mayAccessBooking(booking, caller)) {
        throw problemError('NOT_FOUND', 'No such resource for this caller.');
      }
      return booking;
    },

    async listActiveBookings(accountId) {
      return store.getActiveBookingsByAccount(accountId);
    },

    /**
     * Enters payment (LLD-02 §6): Lua hold + Snap token. Idempotent while
     * PAYMENT_PENDING (returns the existing snap token when present).
     */
    async enterPayment(bookingId, caller) {
      const booking = await store.getBooking(bookingId);
      if (!booking) throw problemError('NOT_FOUND', 'No such resource for this caller.');
      if (!mayAccessBooking(booking, caller)) {
        throw problemError('NOT_FOUND', 'No such resource for this caller.');
      }

      // Already in payment: return the live snap token (idempotent).
      if (booking.status === 'PAYMENT_PENDING') {
        if (booking.snapToken) {
          return {
            bookingId: booking.bookingId,
            snapToken: booking.snapToken,
            paymentExpiresAt: booking.paymentExpiresAt,
            redirectUrl: booking.redirectUrl || null,
            serverNow: serverNow()
          };
        }
        // No snap token yet (a previous attempt failed before Snap): new attempt below.
      }
      if (booking.status !== 'SELECTION' && booking.status !== 'PAYMENT_PENDING') {
        throw problemError('BOOKING_NOT_HELD', 'The booking is paid, expired or cancelled.');
      }
      if (booking.status === 'SELECTION' && new Date(booking.expiresAt).getTime() <= Date.now()) {
        throw problemError('BOOKING_NOT_HELD', 'The booking is paid, expired or cancelled.');
      }
      if (booking.status === 'PAYMENT_PENDING' && new Date(booking.paymentExpiresAt).getTime() <= Date.now()) {
        throw problemError('BOOKING_NOT_HELD', 'The booking is paid, expired or cancelled.');
      }

      // The admission must still be live at payment entry.
      const admission = await stock.getAdmission(booking.admissionToken);
      if (!admission) {
        throw problemError(
          'ADMISSION_INVALID',
          'The admission token is missing, expired or no longer matches a live slot.'
        );
      }

      const items = luaItems(booking);
      // checkAndHold returns the final API error code directly (no mapping layer).
      const held = await stock.checkAndHold(booking.eventId, items);
      if (!held.ok) {
        if (held.code === 'CATEGORY_SOLD_OUT') {
          throw problemError('CATEGORY_SOLD_OUT', 'Pick another category.', { categoryId: held.categoryId });
        }
        const attendee = booking.attendees.find((a) => a.nikHmac === held.nikHmac);
        throw problemError('NIK_SEAT_TAKEN', 'This NIK already holds 3 seats for the event.', {
          nikMasked: attendee ? attendee.nikMasked : undefined
        });
      }

      // DB: SELECTION -> PAYMENT_PENDING (guarded) + nik backstop + attempt.
      const attempt = (booking.attempt || 0) + 1;
      const paymentExpiresAt = new Date(Date.now() + PAYMENT_TTL_MS).toISOString();
      const transitioned = await store.updateBookingStatus(bookingId, 'SELECTION', 'PAYMENT_PENDING', {
        paymentExpiresAt,
        attempt
      });
      if (!transitioned) {
        // Someone else transitioned it meanwhile: release the hold we just made.
        await releaseHold(booking);
        throw problemError('BOOKING_NOT_HELD', 'The booking is paid, expired or cancelled.');
      }
      await Promise.all(
        booking.attendees.map((attendee) => store.incrementNikBackstop(booking.eventId, attendee.nikHmac, 1))
      );

      // Snap via payment-module (internal). Failure -> 503 retryable; the hold
      // is orphaned and released by the reconciler (LLD-02 §6.2).
      const orderId = orderIdFor(bookingId, attempt);
      let snap;
      try {
        snap = await payment.createSnap({
          bookingId,
          attempt,
          orderId,
          grossAmount: transitioned.price.total.amount,
          itemDetails: transitioned.price.lines.map((line) => ({
            id: line.categoryId,
            price: line.unitPrice.amount,
            quantity: line.quantity,
            name: line.name
          }))
        });
      } catch (error) {
        const retryable = problemError('INTERNAL_ERROR', 'Payment is temporarily unavailable; try again.');
        retryable.status = 503;
        retryable.problem.status = 503;
        throw retryable;
      }
      const updated = await store.updateBooking(bookingId, {
        snapToken: snap.snapToken,
        redirectUrl: snap.redirectUrl
      });
      return {
        bookingId: updated.bookingId,
        snapToken: snap.snapToken,
        paymentExpiresAt: updated.paymentExpiresAt,
        redirectUrl: snap.redirectUrl || null,
        serverNow: serverNow()
      };
    },

    /**
     * Check-status (LLD-02 §7, Q26): Get Status via payment-module.
     * Settlement CAN transition the booking to PAID (ADR-0008).
     */
    async checkStatus(bookingId, caller) {
      const booking = await store.getBooking(bookingId);
      if (!booking) throw problemError('NOT_FOUND', 'No such resource for this caller.');
      if (caller && !mayAccessBooking(booking, caller)) {
        throw problemError('NOT_FOUND', 'No such resource for this caller.');
      }
      if (booking.status !== 'SELECTION' && booking.status !== 'PAYMENT_PENDING') return booking;
      const attempt = booking.attempt || 0;
      if (attempt === 0) return booking; // never entered payment: nothing to check
      const orderId = orderIdFor(bookingId, attempt);
      const status = await payment.getStatus(orderId);
      if (!status) return booking; // 404 = no transaction yet (normal)
      if (status.status === 'settlement' || status.status === 'capture') {
        const result = await this.confirmPayment(bookingId, {
          orderId,
          transactionId: status.transactionId,
          transactionStatus: status.status,
          paymentType: status.paymentType,
          grossAmount: status.grossAmount
        });
        return result.booking || booking;
      }
      if (status.status === 'expire') {
        const expired = await this.expireBooking(booking, 'expired');
        return expired || booking;
      }
      return booking; // pending / deny / cancel / failure: booking stays as-is
    },

    /**
     * Payment confirmation (notifyPaymentResult, LLD-03 §5.3): called by the
     * payment-module webhook (via the internal endpoint) and by check-status.
     * Idempotent; a late success NEVER resurrects an expired booking (D11).
     */
    async confirmPayment(bookingId, { orderId, transactionId, transactionStatus, paymentType, grossAmount }) {
      const booking = await store.getBooking(bookingId);
      if (!booking) return { handled: false, reason: 'not_found' };
      if (booking.status === 'PAID') return { handled: true, duplicate: true, booking };
      if (booking.status === 'EXPIRED' || booking.status === 'CANCELLED') {
        // Late payment (D11): log + flag for admin review, no resurrection —
        // and tell the buyer their money will be returned (ADR-0009).
        await store.updateBooking(bookingId, { refundRequired: true });
        const flagged = await store.getBooking(bookingId);
        await enqueueBookingEmail(flagged, (account, event) =>
          buildRefundFlaggedEnvelope({
            account,
            booking: flagged,
            event,
            transactionId,
            paymentType,
            paidAt: new Date().toISOString(),
            refundWindowLabel: emailConfig.refundWindowLabel
          })
        );
        return { handled: true, late: true, booking: flagged };
      }
      if (booking.status !== 'PAYMENT_PENDING') return { handled: false, reason: 'not_held' };
      if (grossAmount !== undefined && grossAmount !== booking.price.total.amount) {
        return { handled: false, reason: 'amount_mismatch' };
      }

      // Guard: only PAYMENT_PENDING -> PAID (0 rows = already transitioned).
      const paid = await store.updateBookingStatus(bookingId, 'PAYMENT_PENDING', 'PAID', {
        paidAt: new Date().toISOString(),
        paymentMethod: paymentType || null
      });
      if (!paid) return { handled: true, duplicate: true, booking: await store.getBooking(bookingId) };

      // Mint public ticket codes (D19) + settle the hold (held -> sold).
      const minted = await mintTickets(paid);
      const withTickets = await store.updateBooking(bookingId, { tickets: minted });
      await settleHold(paid);
      await publishEmptySlot(paid, 'purchase_complete');
      await enqueueBookingEmail(withTickets, (account, event, links) =>
        buildTicketEnvelope({ account, booking: withTickets, event, tickets: minted, links })
      );
      return { handled: true, booking: withTickets, orderId, transactionId, transactionStatus };
    },

    /**
     * Expires one booking (sweeper / Get Status expire). Guarded; releases the
     * hold (PAYMENT_PENDING only), enqueues the expired email, publishes an
     * empty-slot event. Returns the expired booking or null (already moved).
     */
    async expireBooking(booking, reason = 'expired') {
      const from = booking.status;
      if (from !== 'SELECTION' && from !== 'PAYMENT_PENDING') return null;
      const expired = await store.updateBookingStatus(booking.bookingId, from, 'EXPIRED', {});
      if (!expired) return null;
      if (from === 'PAYMENT_PENDING') {
        await releaseHold(expired);
        await Promise.all(
          expired.attendees.map((attendee) => store.incrementNikBackstop(expired.eventId, attendee.nikHmac, -1))
        );
        // Best-effort expire of the Midtrans order (ignore failures).
        try {
          await payment.expire(orderIdFor(expired.bookingId, expired.attempt || 1));
        } catch (_error) {
          // Best-effort only.
        }
        await enqueueBookingEmail(expired, (account, event, links) =>
          buildExpiredEnvelope({ account, booking: expired, event, links })
        );
        await publishEmptySlot(expired, reason);
      }
      return expired;
    },

    /**
     * Sweeper (D9): expires bookings past their deadline (batch 100).
     * SELECTION past expiresAt; PAYMENT_PENDING past paymentExpiresAt.
     */
    async expireDue(now = new Date()) {
      const due = await store.listDueBookings(now.toISOString(), 100);
      const results = await Promise.all(due.map((booking) => this.expireBooking(booking, 'expired')));
      return {
        processed: results.filter(Boolean).length,
        skipped: results.filter((result) => !result).length
      };
    }
  };
}

module.exports = { createBookingUseCase, SELECTION_TTL_MS, PAYMENT_TTL_MS };
