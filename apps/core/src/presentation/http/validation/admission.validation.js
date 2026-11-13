const Joi = require('joi');
const { DEVICE_ID } = require('@/domain/queue-feed');

// POST /v1/core/admission body (same schema as the old SQS admission
// event, LLD-02 §13). All fields required; the queue always sends a slot.
const registerAdmissionBody = Joi.object({
  admission_token: Joi.string().min(1).required(),
  user_id: Joi.string().min(1).required(),
  event_id: Joi.string().min(1).required(),
  slot_id: Joi.string().allow(null).required(),
  // The admission token's sub (BR-06-Q1); optional until every queue sends it.
  device_id: Joi.string().pattern(DEVICE_ID),
  max_tickets: Joi.number().integer().min(1).max(3).required(),
  expires_at: Joi.string().isoDate().required()
});

module.exports = { registerAdmissionBody };
