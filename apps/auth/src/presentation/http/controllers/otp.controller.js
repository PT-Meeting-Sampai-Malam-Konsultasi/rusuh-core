const { apiError } = require('@/application/shared/api-error');
const { requestOtpSchema, verifyOtpSchema } = require('../validation/otp.validation');

/**
 * Creates OTP controllers (openapi.yaml requestOtp / verifyOtp).
 *
 * @param {object} otpUseCase - OTP use case.
 * @returns {object} Controllers.
 */
function createOtpController(otpUseCase) {
  const deviceIdOf = (request) => request.headers['x-device-id'] || request.body?.deviceId || null;

  return {
    request: async (request, response, next) => {
      try {
        const { error, value } = requestOtpSchema.validate(request.body, { abortEarly: false });
        if (error) throw apiError('BAD_REQUEST', `Validasi gagal: ${error.details.map((d) => d.message).join(', ')}`);
        const result = await otpUseCase.requestOtp({ ...value, deviceId: deviceIdOf(request) });
        response.locals.skipResponseEnvelope = true;
        response.status(202).json(result);
      } catch (err) {
        next(err);
      }
    },

    verify: async (request, response, next) => {
      try {
        const { error, value } = verifyOtpSchema.validate(request.body, { abortEarly: false });
        if (error) throw apiError('BAD_REQUEST', `Validasi gagal: ${error.details.map((d) => d.message).join(', ')}`);
        const session = await otpUseCase.verifyOtp({ ...value, deviceId: deviceIdOf(request) });
        response.locals.skipResponseEnvelope = true;
        if (session.refreshToken) {
          // Web: refresh token as a __Host-rt cookie (openapi.yaml).
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
    }
  };
}

module.exports = { createOtpController };
