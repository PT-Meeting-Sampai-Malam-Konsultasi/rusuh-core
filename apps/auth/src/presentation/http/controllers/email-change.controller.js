const { apiError } = require('@/application/shared/api-error');
const { startEmailChangeSchema, verifyEmailChangeSchema } = require('../validation/email-change.validation');

/**
 * Creates email-change controllers (openapi.yaml startEmailChange / verifyEmailChange).
 *
 * @param {object} emailChangeUseCase - Email-change use case.
 * @returns {object} Controllers.
 */
function createEmailChangeController(emailChangeUseCase) {
  const validate = (schema, body) => {
    const { error, value } = schema.validate(body, { abortEarly: false });
    if (error) throw apiError('BAD_REQUEST', `Validasi gagal: ${error.details.map((d) => d.message).join(', ')}`);
    return value;
  };

  return {
    start: async (request, response, next) => {
      try {
        const value = validate(startEmailChangeSchema, request.body);
        const result = await emailChangeUseCase.startEmailChange({
          accountId: request.account.accountId,
          newEmail: value.newEmail
        });
        response.locals.skipResponseEnvelope = true;
        response.status(202).json(result);
      } catch (err) {
        next(err);
      }
    },

    verify: async (request, response, next) => {
      try {
        const value = validate(verifyEmailChangeSchema, request.body);
        const user = await emailChangeUseCase.verifyEmailChange({
          accountId: request.account.accountId,
          ...value
        });
        response.locals.skipResponseEnvelope = true;
        response.status(200).json(user);
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createEmailChangeController };
