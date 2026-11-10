/**
 * Internal endpoint controllers (service-key protected, core-module only).
 *
 * @param {object} internalUseCase - Internal use case.
 * @returns {object} Controllers.
 */
function createInternalController(internalUseCase) {
  return {
    getAccount: async (request, response, next) => {
      try {
        const account = await internalUseCase.getAccount({ accountId: request.params.accountId });
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(account);
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createInternalController };
