const Joi = require('joi');

/** Profile update body (name + locale + optional NIK, ADR-0031). */
const updateProfileSchema = Joi.object({
  fullName: Joi.string().trim().min(1).max(200).required(),
  locale: Joi.string().valid('id', 'en').optional(),
  // Optional own NIK (16 digits, spaces tolerated). null/'' clears it;
  // omitted leaves the stored NIK unchanged. Format is re-checked
  // in the use case (birth-date + sequence rules).
  nik: Joi.string()
    .trim()
    .pattern(/^[0-9 ]{16,19}$/)
    .allow('', null)
    .optional()
});

module.exports = { updateProfileSchema };
