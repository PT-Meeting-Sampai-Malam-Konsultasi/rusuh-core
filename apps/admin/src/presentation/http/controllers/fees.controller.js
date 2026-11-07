const { ApiError } = require('@/errors');
const { feesSchema } = require('./fees.validation');

/**
 * Creates controllers for the admin fee-config endpoints (LLD-05 §5.3).
 *
 * @param {object} feesService - Fee service.
 * @returns {object} Fee endpoint controllers.
 */
function createFeesController(feesService) {
  return {
    getFees: async (_request, response) => {
      response.locals.skipResponseEnvelope = true;
      const fees = await feesService.getFees();
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
      const fees = await feesService.updateFees(value, request.admin);
      response.status(200).json(fees);
    }
  };
}

module.exports = { createFeesController };
