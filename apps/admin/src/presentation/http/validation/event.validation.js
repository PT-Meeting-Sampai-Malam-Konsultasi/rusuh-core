const Joi = require('joi');

const eventStates = [
  'draft',
  'coming_soon',
  'waiting_room_open',
  'on_sale',
  'almost_gone',
  'temporarily_full',
  'sold_out',
  'ended'
];

const categorySchema = Joi.object({
  category_id: Joi.string()
    .pattern(/^cat_[a-z0-9_]+$/)
    .max(100),
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).allow(null, ''),
  seating: Joi.string().valid('seated', 'standing').default('standing'),
  price: Joi.number().integer().min(0).required(),
  total: Joi.number().integer().min(1).required(),
  gate: Joi.string().max(100).allow(null, ''),
  category_code: Joi.string()
    .pattern(/^[A-Z0-9]{2,10}$/)
    .required(),
  almost_sold_out_threshold: Joi.number().integer().min(0).allow(null)
});

const createEventSchema = Joi.object({
  event_id: Joi.string()
    .pattern(/^evt_[a-z0-9_]+$/)
    .max(100),
  name: Joi.string().min(1).max(200).required(),
  subtitle: Joi.string().max(300).allow(null, ''),
  format: Joi.string().max(100).allow(null, ''),
  venue: Joi.string().min(1).max(200).required(),
  venue_short: Joi.string().max(100).allow(null, ''),
  city: Joi.string().max(100).allow(null, ''),
  timezone: Joi.string().max(100).default('Asia/Jakarta'),
  starts_at: Joi.string().isoDate().required(),
  doors_open_at: Joi.string().isoDate().allow(null, ''),
  sale_opens_at: Joi.string().isoDate().allow(null, ''),
  waiting_room_opens_at: Joi.string().isoDate().allow(null, ''),
  sale_ends_at: Joi.string().isoDate().allow(null, ''),
  state: Joi.string()
    .valid(...eventStates)
    .default('draft'),
  capacity: Joi.number().integer().min(0).required(),
  image_url: Joi.string().uri().allow(null, ''),
  event_code: Joi.string()
    .pattern(/^[A-Z0-9]{2,10}$/)
    .required(),
  categories: Joi.array().items(categorySchema).min(1).required(),
  cap_tier: Joi.number().valid(1, 3, 10).allow(null),
  cap: Joi.number().integer().min(0).allow(null),
  infra_cap: Joi.number().integer().min(0).allow(null)
});

const updateEventSchema = createEventSchema
  .fork(['name', 'venue', 'starts_at', 'capacity', 'event_code', 'categories'], (schema) => schema.optional())
  .keys({ event_id: Joi.forbidden() })
  .min(1);

const imageUploadSchema = Joi.object({
  content_type: Joi.string().required()
});

const capSchema = Joi.object({
  cap: Joi.number().integer().min(0),
  cap_tier: Joi.number().valid(1, 3, 10)
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

module.exports = { createEventSchema, updateEventSchema, imageUploadSchema, capSchema, paginationSchema, eventStates };
