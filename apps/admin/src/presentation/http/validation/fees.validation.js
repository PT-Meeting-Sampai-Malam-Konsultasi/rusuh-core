const Joi = require('joi');

const feesSchema = Joi.object({
  platform_fee: Joi.number().integer().min(0),
  admin_fee: Joi.number().integer().min(0).allow(null),
  tax1_rate: Joi.number().min(0).max(1),
  tax2: Joi.object({
    rate: Joi.number().min(0).max(1),
    base: Joi.string().valid('platform_fee', 'subtotal'),
    label: Joi.string().min(1).max(100)
  })
}).min(1);

module.exports = { feesSchema };
