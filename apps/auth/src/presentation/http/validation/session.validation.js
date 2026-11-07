const Joi = require('joi');

/** Refresh body (openapi.yaml refreshSession; mobile only, web uses cookie). */
const refreshSchema = Joi.object({
  refreshToken: Joi.string().optional(),
  deviceId: Joi.string().optional()
});

/** Logout body (optional refresh token; the Bearer access token is primary). */
const logoutSchema = Joi.object({
  refreshToken: Joi.string().optional()
});

module.exports = { refreshSchema, logoutSchema };
