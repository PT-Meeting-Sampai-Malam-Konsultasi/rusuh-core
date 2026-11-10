const { problemError } = require('@/domain/problem');
const { validateAttendeeBody, eventIdParam } = require('../validation/attendees.validation');

/**
 * Creates controllers for the attendee validation endpoint.
 *
 * @param {object} useCase - Attendees use case.
 * @returns {object} Attendee endpoint controllers.
 */
function createAttendeesController(useCase) {
  return {
    validateAttendee: async (request, response, next) => {
      try {
        const { error: paramError } = eventIdParam.validate(request.params);
        if (paramError) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const { error, value } = validateAttendeeBody.validate(request.body);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const result = await useCase.validateAttendee(request.params.eventId, request.admission, value);
        response.locals.skipResponseEnvelope = true;
        response.status(200).json({
          validationToken: result.validationToken,
          nikMasked: result.nikMasked,
          expiresAt: result.expiresAt
        });
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createAttendeesController };
