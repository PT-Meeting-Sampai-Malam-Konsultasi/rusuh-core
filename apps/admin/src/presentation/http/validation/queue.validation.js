const Joi = require('joi');

const queueStateSchema = Joi.object({
  state: Joi.string().valid('open', 'paused', 'closed'),
  maxConcurrentSlots: Joi.number().integer().min(0),
  rateCapPerSecond: Joi.number().integer().min(0),
  streamFrom: Joi.number().integer().min(0),
  reason: Joi.string().max(500)
}).min(1);

module.exports = { queueStateSchema };
