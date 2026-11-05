const Joi = require('joi');

const createBookingBody = Joi.object({
  eventId: Joi.string().required(),
  tickets: Joi.array()
    .items(
      Joi.object({
        categoryId: Joi.string().required(),
        validationToken: Joi.string().required()
      })
    )
    .min(1)
    .max(3)
    .required()
});

const bookingIdParam = Joi.object({
  bookingId: Joi.string().required()
});

const paymentResultBody = Joi.object({
  orderId: Joi.string().required(),
  transactionId: Joi.string().allow(null),
  transactionStatus: Joi.string().required(),
  paymentType: Joi.string().allow(null),
  grossAmount: Joi.number().integer().min(0).required()
});

module.exports = { createBookingBody, bookingIdParam, paymentResultBody };
