/**
 * Shared API error codes (repo contract, api/openapi.yaml, RFC 9457 Problem).
 * Controllers throw Boom errors with the repo code in `data.code`; the
 * error-handler middleware renders them as Problem JSON.
 */
const ERROR_CODES = Object.freeze({
  UNAUTHORIZED: { status: 401, title: 'Unauthorized' },
  ADMISSION_INVALID: { status: 403, title: 'Admission token invalid' },
  NOT_FOUND: { status: 404, title: 'Not found' },
  QUANTITY_OVER_RESERVATION: { status: 409, title: 'Quantity exceeds admission' },
  DUPLICATE_NIK: { status: 409, title: 'Duplicate NIK in one order' },
  NIK_SEAT_TAKEN: { status: 409, title: 'NIK already holds 3 seats' },
  CATEGORY_SOLD_OUT: { status: 409, title: 'Category sold out' },
  BOOKING_NOT_HELD: { status: 409, title: 'Booking is not held' },
  NOT_CANCELLABLE: { status: 409, title: 'Booking is not cancellable' },
  ATTENDEE_NOT_VALIDATED: { status: 409, title: 'Attendee not validated' },
  QUEUE_CLOSED: { status: 410, title: 'Queue is closed' },
  MISSED: { status: 410, title: 'Turn missed' },
  EXPIRED: { status: 410, title: 'Expired' },
  NIK_INVALID: { status: 422, title: 'NIK invalid' },
  WRONG_CODE: { status: 409, title: 'Wrong OTP code' },
  CHALLENGE_EXPIRED: { status: 410, title: 'OTP challenge expired' },
  CHALLENGE_LOCKED: { status: 410, title: 'OTP challenge locked' },
  DUKCAPIL_UNAVAILABLE: { status: 503, title: 'Dukcapil verification unavailable' }
});

/**
 * Builds a Problem (RFC 9457) body for an API error.
 *
 * @param {string} code - One of ERROR_CODES.
 * @param {string} [detail] - Human-readable detail.
 * @param {object} [extra] - Extra Problem members (e.g. categoryId, attemptsLeft).
 * @returns {object} Problem body.
 */
function problem(code, detail, extra = {}) {
  const known = ERROR_CODES[code] || { status: 500, title: 'Internal Server Error' };
  return {
    type: 'about:blank',
    title: known.title,
    status: known.status,
    code,
    ...(detail ? { detail } : {}),
    ...extra
  };
}

module.exports = { ERROR_CODES, problem };
