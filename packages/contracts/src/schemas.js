const Joi = require('joi');

/** NIK: 16 digits (format only; existence is checked against Dukcapil). */
const nik = Joi.string()
  .pattern(/^\d{16}$/)
  .required();

/** Email address (account identifier). */
const email = Joi.string().email().required();

/** ULID-ish / opaque ids used across services (admission token, slot id). */
const admissionToken = Joi.string()
  .pattern(/^adm_[A-Za-z0-9_-]+$/)
  .required();
const slotId = Joi.string()
  .pattern(/^s_[A-Za-z0-9_-]+$/)
  .required();
const deviceId = Joi.string()
  .pattern(/^[wm]_[A-Za-z0-9_-]{16,32}$/)
  .required();

/** One attendee (one ticket): category + validated attendee token. */
const ticketRequest = Joi.object({
  category_id: Joi.string().required(),
  validation_token: Joi.string().required()
});

module.exports = { nik, email, admissionToken, slotId, deviceId, ticketRequest };
