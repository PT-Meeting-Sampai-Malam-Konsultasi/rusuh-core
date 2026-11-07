const Joi = require('joi');

const itemDetailSchema = Joi.object({
  id: Joi.string().required(),
  price: Joi.number().integer().min(0).required(),
  quantity: Joi.number().integer().min(1).required(),
  name: Joi.string().required()
});

const createSnapSchema = Joi.object({
  bookingId: Joi.string().required(),
  grossAmount: Joi.number().integer().positive().required(),
  itemDetails: Joi.array().items(itemDetailSchema).min(1).required(),
  customerDetails: Joi.object({
    email: Joi.string().email(),
    firstName: Joi.string()
  }).optional(),
  snapStartTime: Joi.date().required(),
  method: Joi.string().optional(),
  callbacks: Joi.object({
    finish: Joi.string().uri(),
    unfinish: Joi.string().uri(),
    error: Joi.string().uri()
  }).optional()
});

module.exports = { createSnapSchema, itemDetailSchema };
