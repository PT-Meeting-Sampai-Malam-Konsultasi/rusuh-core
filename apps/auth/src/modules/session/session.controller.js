const { apiError } = require('@/lib/api-error');
const { refreshSchema, logoutSchema } = require('./session.validation');

/**
 * Creates session controllers (openapi.yaml refreshSession / logout).
 *
 * @param {object} sessionService - Session service.
 * @returns {object} Controllers.
 */
function createSessionController(sessionService) {
  const refreshTokenOf = (request) => request.cookies?.['__Host-rt'] || request.body?.refreshToken || null;
  const deviceIdOf = (request) => request.headers['x-device-id'] || request.body?.deviceId || null;

  return {
    refresh: async (request, response, next) => {
      try {
        const { error, value } = refreshSchema.validate(request.body || {}, { abortEarly: false });
        if (error) throw apiError('BAD_REQUEST', `Validasi gagal: ${error.details.map((d) => d.message).join(', ')}`);
        const session = await sessionService.refresh({
          refreshToken: refreshTokenOf(request) || value.refreshToken,
          deviceId: deviceIdOf(request)
        });
        response.locals.skipResponseEnvelope = true;
        if (session.refreshToken) {
          response.cookie('__Host-rt', session.refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            path: '/v1/auth',
            maxAge: 7 * 24 * 60 * 60 * 1000
          });
        }
        response.status(200).json(session);
      } catch (err) {
        next(err);
      }
    },

    logout: async (request, response, next) => {
      try {
        const { error, value } = logoutSchema.validate(request.body || {}, { abortEarly: false });
        if (error) throw apiError('BAD_REQUEST', `Validasi gagal: ${error.details.map((d) => d.message).join(', ')}`);
        await sessionService.logout({
          accessJti: request.account?.jti,
          accessExp: request.account?.exp,
          refreshToken: refreshTokenOf(request) || value.refreshToken
        });
        response.locals.skipResponseEnvelope = true;
        response.clearCookie('__Host-rt', { path: '/v1/auth' });
        response.status(204).send();
      } catch (err) {
        next(err);
      }
    }
  };
}

module.exports = { createSessionController };
