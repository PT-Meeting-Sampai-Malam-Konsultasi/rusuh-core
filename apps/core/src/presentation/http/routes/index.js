const { createHealthService } = require('@/modules/health/health.service');
const { createHealthController } = require('@/modules/health/health.controller');
const { createHealthRouter } = require('@/modules/health/health.route');
const { createEventsController } = require('@/modules/events/events.controller');
const { createEventsRouter } = require('@/modules/events/events.route');
const { createAttendeesController } = require('@/modules/attendees/attendees.controller');
const { createAttendeesRouter } = require('@/modules/attendees/attendees.route');
const { createBookingsController } = require('@/modules/bookings/bookings.controller');
const { createBookingsRouter } = require('@/modules/bookings/bookings.route');
const { createTicketsController } = require('@/modules/tickets/tickets.controller');
const { createTicketsRouter } = require('@/modules/tickets/tickets.route');
const { createDefaultDeps } = require('@/infrastructure/deps');

/**
 * Mounts service routers and returns the reusable module dependencies.
 * When `deps` is not provided, the default (in-memory) dependency graph is
 * built from the config, so the app boots with no live infrastructure.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {object} [options.config] - Validated service configuration.
 * @param {object} [options.platform] - Platform helper implementation.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {object} [options.deps] - Pre-built dependency graph (createDeps).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { config, isReady, deps } = {}) {
  const graph = deps || createDefaultDeps(config);
  const healthService = createHealthService({ isReady });
  const healthController = createHealthController(healthService);

  const eventsController = createEventsController(graph.services.events);
  const attendeesController = createAttendeesController(graph.services.attendees);
  const bookingsController = createBookingsController(graph.services.bookings);
  const ticketsController = createTicketsController(graph.services.tickets);

  app.use(createHealthRouter(healthController));
  app.use(createEventsRouter(eventsController, graph.auth));
  app.use(createAttendeesRouter(attendeesController, graph.auth));
  app.use(createBookingsRouter(bookingsController, graph.auth));
  app.use(createTicketsRouter(ticketsController, graph.auth));

  return { healthService, deps: graph };
}

module.exports = { mountRoutes };
