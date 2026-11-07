const { ApiError } = require('@/domain/errors');
const { queueStateSchema } = require('../validation/queue.validation');

/**
 * Creates controllers for the queue-admin endpoint (J8 A / item 13).
 *
 * @param {object} queueUseCase - Queue use case.
 * @returns {object} Queue endpoint controllers.
 */
function createQueueController(queueUseCase) {
  return {
    updateQueue: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const { error, value } = queueStateSchema.validate(request.body, {
        abortEarly: false,
        convert: true,
        stripUnknown: true
      });
      if (error) throw new ApiError('VALIDATION_FAILED', error.details.map((detail) => detail.message).join(', '));
      const frontier = await queueUseCase.updateQueue(request.params.eventId, value, request.admin);
      response.status(200).json(frontier);
    }
  };
}

module.exports = { createQueueController };
