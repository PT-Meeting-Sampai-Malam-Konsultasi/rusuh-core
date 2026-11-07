const { ApiError } = require('@/errors');
const { listUsersSchema } = require('./users.validation');

/**
 * Creates controllers for the admin user endpoints (LLD-05 §6.3).
 *
 * @param {object} usersService - User service.
 * @returns {object} User endpoint controllers.
 */
function createUsersController(usersService) {
  return {
    listUsers: async (request, response) => {
      response.locals.skipResponseEnvelope = true;
      const { error, value } = listUsersSchema.validate(request.query, {
        abortEarly: false,
        convert: true,
        stripUnknown: true
      });
      if (error) throw new ApiError('VALIDATION_FAILED', error.details.map((detail) => detail.message).join(', '));
      const { data, total } = await usersService.listUsers(value);
      response.status(200).json({ data, meta: { total, page: value.page, limit: value.limit } });
    }
  };
}

module.exports = { createUsersController };
