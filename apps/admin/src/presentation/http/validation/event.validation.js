const Joi = require('joi');

const categorySchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  price: Joi.number().integer().min(0).required(),
  total: Joi.number().integer().min(1).required(),
  gate: Joi.string().max(100).allow(null, ''),
  almost_sold_out_threshold: Joi.number().integer().min(0).allow(null)
});

const createEventSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  venue: Joi.string().min(1).max(200).required(),
  date: Joi.string().isoDate().required(),
  doors_open_at: Joi.string().isoDate().required(),
  categories: Joi.array().items(categorySchema).min(1).required(),
  cap_tier: Joi.number().valid(1, 3, 10).allow(null),
  cap: Joi.number().integer().min(0).allow(null),
  infra_cap: Joi.number().integer().min(0).allow(null)
});

const updateEventSchema = Joi.object({
  name: Joi.string().min(1).max(200),
  venue: Joi.string().min(1).max(200),
  date: Joi.string().isoDate(),
  doors_open_at: Joi.string().isoDate(),
  categories: Joi.array().items(categorySchema).min(1)
}).min(1);

const capSchema = Joi.object({
  cap: Joi.number().integer().min(0),
  cap_tier: Joi.number().valid(1, 3, 10)
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

module.exports = { createEventSchema, updateEventSchema, capSchema, paginationSchema };
