const { createHealthUseCase } = require('@/application/health/health.use-case');
const { createHealthController } = require('@/presentation/http/controllers/health.controller');
const { createHealthRouter } = require('@/presentation/http/routes/health.route');
const { createEventsController } = require('@/presentation/http/controllers/events.controller');
const { createEventsRouter } = require('@/presentation/http/routes/events.route');
const { createAttendeesController } = require('@/presentation/http/controllers/attendees.controller');
const { createAttendeesRouter } = require('@/presentation/http/routes/attendees.route');
const { createBookingsController } = require('@/presentation/http/controllers/bookings.controller');
const { createBookingsRouter } = require('@/presentation/http/routes/bookings.route');
const { createTicketsController } = require('@/presentation/http/controllers/tickets.controller');
const { createTicketsRouter } = require('@/presentation/http/routes/tickets.route');
const { createAdmissionController } = require('@/presentation/http/controllers/admission.controller');
const { createAdmissionRouter } = require('@/presentation/http/routes/admission.route');

/**
 * Mounts service routers and returns the reusable module dependencies.
 * The dependency graph (`deps`) is built by the composition root (app.js /
 * container.js) and passed in — this file never builds the graph itself
 * (Onion boundary: presentation/ may not import the container).
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {object} options - Router dependencies and feature flags.
 * @param {object} [options.platform] - Platform helper implementation.
 * @param {Function} [options.isReady] - Optional readiness predicate.
 * @param {Function} [options.isShuttingDown] - Optional shutdown predicate (for /readyz).
 * @param {object} options.deps - Pre-built dependency graph (required).
 * @returns {object} Mounted service modules.
 */
function mountRoutes(app, { isReady, isShuttingDown, deps } = {}) {
  if (!deps) throw new Error('mountRoutes requires deps (built by the composition root)');
  const graph = deps;
  const healthUseCase = createHealthUseCase({ isReady, isShuttingDown });
  const healthController = createHealthController(healthUseCase);

  const eventsController = createEventsController(graph.useCases.events);
  const attendeesController = createAttendeesController(graph.useCases.attendees);
  const bookingsController = createBookingsController(graph.useCases.bookings);
  const ticketsController = createTicketsController(graph.useCases.tickets);
  const admissionController = createAdmissionController(graph.useCases.admission);

  app.use(createHealthRouter(healthController));
  app.use(createAdmissionRouter(admissionController, graph.auth));
  app.use(createEventsRouter(eventsController, graph.auth));
  app.use(createAttendeesRouter(attendeesController, graph.auth));
  app.use(createBookingsRouter(bookingsController, graph.auth));
  app.use(createTicketsRouter(ticketsController, graph.auth));

  return { healthUseCase, deps: graph };
}

module.exports = { mountRoutes };
