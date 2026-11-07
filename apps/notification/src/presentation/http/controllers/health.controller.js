/**
 * Creates controllers for operational service endpoints.
 *
 * @param {object} healthService - Health service implementation.
 * @returns {object} Health endpoint controllers.
 */
function createHealthController(healthService) {
  return {
    ping: (_request, response) => {
      response.locals.skipResponseEnvelope = true;
      response.type('text/plain').send('ok');
    },
    live: (_request, response) => {
      response.locals.skipResponseEnvelope = true;
      response.status(200).json(healthService.live());
    },
    ready: async (_request, response) => {
      const result = await healthService.ready();
      response.locals.skipResponseEnvelope = true;
      response.status(result.status === 'ready' ? 200 : 503).json(result);
    }
  };
}

module.exports = { createHealthController };
