const Boom = require('@hapi/boom');

/**
 * Creates the controller for the internal core -> payment operations (LLD-03
 * §4.1, §6). It only translates HTTP to the existing use cases and maps their
 * outcomes to the status codes core's client expects; no business logic lives
 * here. Responses skip the platform envelope because core parses the JSON as is.
 *
 * @param {object} options - Controller dependencies.
 * @param {object} [options.snapUseCase] - Snap use case (null when Midtrans is not configured).
 * @param {object} [options.statusUseCase] - Status use case (null when Midtrans is not configured).
 * @returns {object} Express handlers: createSnap, getStatus, expire.
 */
function createInternalController({ snapUseCase, statusUseCase } = {}) {
  function send(response, status, body) {
    response.locals.skipResponseEnvelope = true;
    response.status(status).json(body);
  }

  return {
    createSnap: async (request, response, next) => {
      if (!snapUseCase) {
        next(Boom.serverUnavailable('Payment gateway is not configured'));
        return;
      }
      try {
        const result = await snapUseCase.createSnapTransaction(request.body);
        send(response, 200, result);
      } catch (error) {
        next(error);
      }
    },

    getStatus: async (request, response, next) => {
      if (!statusUseCase) {
        next(Boom.serverUnavailable('Payment gateway is not configured'));
        return;
      }
      try {
        const confirmed = await statusUseCase.confirmViaGetStatus(request.params.orderId);
        send(response, 200, {
          status: confirmed.transactionStatus,
          grossAmount: confirmed.grossAmount,
          transactionId: confirmed.transactionId,
          paymentType: confirmed.paymentType
        });
      } catch (error) {
        if (error.code === 'GET_STATUS_NOT_FOUND') {
          send(response, 404, { statusCode: 404, error: 'Not Found', message: 'No transaction for this order yet' });
          return;
        }
        if (error.code === 'GET_STATUS_UNCONFIRMED') {
          send(response, 502, {
            statusCode: 502,
            error: 'Bad Gateway',
            message: 'Payment status could not be confirmed'
          });
          return;
        }
        next(error);
      }
    },

    expire: async (request, response, next) => {
      if (!statusUseCase) {
        next(Boom.serverUnavailable('Payment gateway is not configured'));
        return;
      }
      try {
        const result = await statusUseCase.expireOrder(request.params.orderId);
        if (result.alreadySettledOrExpired) {
          send(response, 412, {
            statusCode: 412,
            error: 'Precondition Failed',
            message: 'Order already expired or settled'
          });
          return;
        }
        if (!result.ok) {
          send(response, 502, { statusCode: 502, error: 'Bad Gateway', message: 'Order could not be expired' });
          return;
        }
        send(response, 200, { ok: true, orderId: result.orderId });
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = { createInternalController };
