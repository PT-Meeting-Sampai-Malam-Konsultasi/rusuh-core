/**
 * Creates controllers for operational service endpoints.
 *
 * @param {object} healthUseCase - Health use case.
 * @returns {object} Health endpoint controllers.
 */
function createHealthController(healthUseCase) {
  return {
    ping: (_request, response) => {
      response.locals.skipResponseEnvelope = true;
      response.type('text/plain').send('ok');
    },
    live: (_request, response) => {
      response.locals.skipResponseEnvelope = true;
      response.status(200).json(healthUseCase.live());
    },
    ready: async (_request, response) => {
      const result = await healthUseCase.ready();
      response.locals.skipResponseEnvelope = true;
      response.status(result.status === 'ready' ? 200 : 503).json(result);
    }
  };
}

module.exports = { createHealthController };
