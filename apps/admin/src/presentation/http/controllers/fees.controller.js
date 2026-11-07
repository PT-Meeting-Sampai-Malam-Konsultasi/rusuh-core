const { ApiError } = require('@/domain/errors');
const { feesSchema } = require('../validation/fees.validation');

/**
 * Creates controllers for the admin fee-config endpoints (LLD-05 §5.3).
 *
 * @param {object} feesUseCase - Fee use case.
 * @returns {object} Fee endpoint controllers.
 */
function createFeesController(feesUseCase) {
  return {
    getFees: async (_request, response) => {
      response.locals.skipResponseEnvelope = true;
      const fees = await feesUseCase.getFees();
      response.status(200).json(fees);
    },

    updateFees: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const { error, value } = feesSchema.validate(request.body, {
        abortEarly: false,
        convert: true,
        stripUnknown: true
      });
      if (error) throw new ApiError('VALIDATION_FAILED', error.details.map((detail) => detail.message).join(', '));
      const fees = await feesUseCase.updateFees(value, request.admin);
      response.status(200).json(fees);
    }
  };
}

module.exports = { createFeesController };
