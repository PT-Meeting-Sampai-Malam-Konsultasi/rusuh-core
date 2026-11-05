const { problemError } = require('@/lib/problem');

/**
 * Tickets (D19): paid tickets only. The public ticket code is minted at
 * payment success; /tickets never returns unpaid bookings.
 *
 * @param {object} deps
 * @param {object} deps.store - Durable store (tickets, bookings).
 * @returns {object} Tickets service.
 */
function createTicketsService({ store }) {
  return {
    async listMyTickets(accountId) {
      return store.listTicketsByAccount(accountId);
    },

    async getTicket(ticketId, accountId) {
      const ticket = await store.getTicket(ticketId);
      if (!ticket) throw problemError('NOT_FOUND', 'No such resource for this caller.');
      const booking = await store.getBooking(ticket.bookingId);
      if (!booking || booking.accountId !== accountId || booking.status !== 'PAID') {
        throw problemError('NOT_FOUND', 'No such resource for this caller.');
      }
      return ticket;
    }
  };
}

module.exports = { createTicketsService };
