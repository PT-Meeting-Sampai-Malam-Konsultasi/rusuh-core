const Joi = require('joi');

// POST /v1/core/admission body (same schema as the old SQS admission
// event, LLD-02 §13). All fields required; the queue always sends a slot.
const registerAdmissionBody = Joi.object({
  admission_token: Joi.string().min(1).required(),
  user_id: Joi.string().min(1).required(),
  event_id: Joi.string().min(1).required(),
  slot_id: Joi.string().allow(null).required(),
  max_tickets: Joi.number().integer().min(1).max(3).required(),
  expires_at: Joi.string().isoDate().required()
});

module.exports = { registerAdmissionBody };
