const Joi = require('joi');

/** Profile update body (name only, D17 corrected). */
const updateProfileSchema = Joi.object({
  fullName: Joi.string().trim().min(1).max(200).required(),
  locale: Joi.string().valid('id', 'en').optional()
});

module.exports = { updateProfileSchema };
