const Joi = require('joi');

const EVENT_STATES = [
  'coming_soon',
  'waiting_room_open',
  'on_sale',
  'almost_gone',
  'temporarily_full',
  'sold_out',
  'ended'
];

const listEventsQuery = Joi.object({
  state: Joi.alternatives().try(
    Joi.string().valid(...EVENT_STATES),
    Joi.array().items(Joi.string().valid(...EVENT_STATES))
  )
});

const eventIdParam = Joi.object({
  eventId: Joi.string().required()
});

module.exports = { listEventsQuery, eventIdParam };
