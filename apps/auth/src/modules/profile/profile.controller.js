const { apiError } = require('@/lib/api-error');
const { updateProfileSchema } = require('./profile.validation');

/**
 * Creates profile controllers (openapi.yaml getMe + LLD-01 profile update).
 *
 * @param {object} profileService - Profile service.
 * @returns {object} Controllers.
 */
function createProfileController(profileService) {
  return {
    getMe: async (request, response, next) => {
      try {
        const user = await profileService.getMe({ accountId: request.account.accountId });
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(user);
      } catch (err) {
        next(err);
      }
    },

    update: async (request, response, next) => {
      try {
        const { error, value } = updateProfileSchema.validate(request.body, { abortEarly: false });
        if (error) throw apiError('BAD_REQUEST', `Validasi gagal: ${error.details.map((d) => d.message).join(', ')}`);
        const user = await profileService.updateProfile({
          accountId: request.account.accountId,
          fullName: value.fullName,
          locale: value.locale
        });
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(user);
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createProfileController };
