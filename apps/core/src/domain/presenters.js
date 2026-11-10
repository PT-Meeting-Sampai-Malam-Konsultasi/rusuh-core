/**
 * Presenters: map internal rows to the public API shapes (openapi.yaml).
 * Booking states are the internal ones (SELECTION, PAYMENT_PENDING, PAID,
 * EXPIRED, CANCELLED). The yaml BookingStatus enum ([HELD, PAID, EXPIRED,
 * CANCELLED]) does not cover SELECTION / PAYMENT_PENDING yet — the yaml
 * needs extending (flagged in the module report).
 */

function serverNow() {
  return new Date().toISOString();
}

function presentEvent(event) {
  return {
    eventId: event.eventId,
    name: event.name,
    subtitle: event.subtitle || null,
    format: event.format || null,
    venue: event.venue,
    venueShort: event.venueShort || null,
    city: event.city || null,
    timezone: event.timezone || 'Asia/Jakarta',
    startsAt: event.startsAt,
    doorsOpenAt: event.doorsOpenAt || null,
    saleOpensAt: event.saleOpensAt || null,
    waitingRoomOpensAt: event.waitingRoomOpensAt || null,
    saleEndsAt: event.saleEndsAt || null,
    state: event.state,
    priceFrom: event.priceFrom || null,
    capacity: event.capacity ?? null,
    soldOutAt: event.soldOutAt || null,
    imageUrl: event.imageUrl || null
  };
}

/**
 * Category availability (Q20): HAMPIR HABIS = config per category,
 * default min(10% of the category total, 100 tickets).
 */
function availabilityOf(available, total, threshold) {
  if (available <= 0) return 'sold_out';
  const limit = threshold ?? Math.min(Math.floor(total * 0.1), 100);
  if (available <= limit) return 'almost_gone';
  return 'available';
}

function presentCategory(category, available, threshold) {
  return {
    categoryId: category.categoryId,
    name: category.name,
    description: category.description || null,
    seating: category.seating,
    entryGate: category.entryGate || null,
    price: { amount: category.price, currency: 'IDR' },
    availability: availabilityOf(available, category.total, threshold),
    available
  };
}

function presentAttendee(attendee) {
  return {
    categoryId: attendee.categoryId,
    categoryName: attendee.categoryName,
    fullName: attendee.fullName,
    nikMasked: attendee.nikMasked
  };
}

function presentTicket(ticket) {
  return {
    ticketId: ticket.ticketId,
    ticketCode: ticket.ticketCode,
    bookingId: ticket.bookingId,
    eventId: ticket.eventId,
    categoryId: ticket.categoryId,
    categoryName: ticket.categoryName,
    seating: ticket.seating,
    entryGate: ticket.entryGate,
    holderName: ticket.holderName,
    nikMasked: ticket.nikMasked,
    qrPayload: ticket.qrPayload,
    issuedAt: ticket.issuedAt
  };
}

function presentBooking(booking) {
  const attendees = (booking.attendees || []).map(presentAttendee);
  const tickets = (booking.tickets || []).map(presentTicket);
  return {
    bookingId: booking.bookingId,
    eventId: booking.eventId,
    status: booking.status,
    price: booking.price,
    orderCode: booking.orderCode,
    attendees,
    expiresAt: booking.status === 'PAID' ? null : booking.paymentExpiresAt || booking.expiresAt || null,
    refundRequired: Boolean(booking.refundRequired),
    tickets,
    paidAt: booking.paidAt || null,
    paymentMethod: booking.paymentMethod || null,
    createdAt: booking.createdAt,
    serverNow: serverNow()
  };
}

module.exports = {
  serverNow,
  presentEvent,
  presentCategory,
  availabilityOf,
  presentAttendee,
  presentBooking,
  presentTicket
};
