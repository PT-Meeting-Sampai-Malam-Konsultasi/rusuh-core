const { problemError } = require('@/domain/problem');
const { registerAdmissionBody } = require('../validation/admission.validation');

/**
 * Creates controllers for the admission endpoint.
 *
 * @param {object} useCase - Admission use case.
 * @returns {object} Admission endpoint controllers.
 */
function createAdmissionController(useCase) {
  return {
    /**
     * Internal registerAdmission endpoint (synchronous; ADR-0027).
     * Called by queue-module over the private network with a service key.
     * Not part of the public API.
     */
    registerAdmission: async (request, response, next) => {
      try {
        const { error, value } = registerAdmissionBody.validate(request.body);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const result = await useCase.registerAdmission(value);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json({ stored: result.stored });
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createAdmissionController };
