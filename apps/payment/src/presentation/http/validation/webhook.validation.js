const Joi = require('joi');

/**
 * Midtrans HTTP notification (openapi.yaml MidtransNotification schema).
 * Required: order_id, status_code, gross_amount, signature_key,
 * transaction_status, transaction_id. fraud_status is only present for
 * card payments (capture); it decides whether a capture is accepted.
 */
const midtransNotificationSchema = Joi.object({
  order_id: Joi.string().required(),
  status_code: Joi.string().required(),
  gross_amount: Joi.string().required(),
  signature_key: Joi.string().required(),
  transaction_status: Joi.string()
    .valid('capture', 'settlement', 'pending', 'deny', 'cancel', 'expire', 'failure', 'refund', 'partial_refund')
    .required(),
  fraud_status: Joi.string().valid('accept', 'deny', 'challenge').optional(),
  transaction_id: Joi.string().required(),
  payment_type: Joi.string().optional(),
  transaction_time: Joi.string().optional(),
  currency: Joi.string().optional()
}).unknown(true);

module.exports = { midtransNotificationSchema };
