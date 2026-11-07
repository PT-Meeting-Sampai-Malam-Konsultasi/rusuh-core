const { problemError } = require('@/lib/problem');
const { validateAttendeeBody, eventIdParam } = require('./attendees.validation');

/**
 * Creates controllers for the attendee validation endpoint.
 *
 * @param {object} service - Attendees service.
 * @returns {object} Attendee endpoint controllers.
 */
function createAttendeesController(service) {
  return {
    validateAttendee: async (request, response, next) => {
      try {
        const { error: paramError } = eventIdParam.validate(request.params);
        if (paramError) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const { error, value } = validateAttendeeBody.validate(request.body);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const result = await service.validateAttendee(request.params.eventId, request.admission, value);
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
