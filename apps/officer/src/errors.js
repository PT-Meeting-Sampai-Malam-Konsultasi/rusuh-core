const Boom = require('@hapi/boom');
const { ERROR_CODES, problem } = require('@rusuh/contracts');

/**
 * Officer-module error codes (LLD-05 §4.1 + §9).
 *
 * NOTE (yaml sync gap): TIKET_TIDAK_DITEMUKAN, TIKET_SUDAH_DIGUNAKAN,
 * TIKET_TIDAK_BERLAKU, FORBIDDEN and SERVICE_UNAVAILABLE are not yet in the
 * openapi.yaml ErrorCode enum — they must be added there (the yaml sync step).
 * The codes follow the repo's pattern of specific machine codes (cf. the enum's
 * NIK_SEAT_TAKEN, BOOKING_NOT_HELD, …) and the LLD-05 contract.
 */
const OFFICER_ERROR_CODES = Object.freeze({
  TIKET_TIDAK_DITEMUKAN: { status: 404, title: 'Ticket not found' },
  TIKET_SUDAH_DIGUNAKAN: { status: 409, title: 'Ticket already used' },
  TIKET_TIDAK_BERLAKU: { status: 409, title: 'Ticket not valid for this event date' },
  FORBIDDEN: { status: 403, title: 'Forbidden' },
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service unavailable' }
});

/**
 * Whether a code is a known repo/officer machine code (so the error-handler
 * may render it as Problem JSON, including for plain Errors thrown by
 * @rusuh/auth, which carry `code` + `status` but are not Boom errors).
 *
 * @param {string} code - Machine code.
 * @returns {boolean} True when known.
 */
function isKnownCode(code) {
  return Boolean(code && (OFFICER_ERROR_CODES[code] || ERROR_CODES[code]));
}

/**
 * Builds a Problem (RFC 9457) body. Officer codes use the same shape as
 * @rusuh/contracts problem(); generic repo codes delegate to it.
 *
 * @param {string} code - Officer or repo error code.
 * @param {string} [detail] - Human-readable detail.
 * @param {object} [extra] - Extra Problem members.
 * @returns {object} Problem body.
 */
function officerProblem(code, detail, extra = {}) {
  const known = OFFICER_ERROR_CODES[code];
  if (known) {
    return {
      type: 'about:blank',
      title: known.title,
      status: known.status,
      code,
      ...(detail ? { detail } : {}),
      ...extra
    };
  }
  return problem(code, detail, extra);
}

/**
 * Creates a Boom error carrying the machine code in `data.code`, so the
 * error-handler middleware renders it as Problem JSON.
 *
 * @param {string} code - Officer or repo error code.
 * @param {string} [detail] - Human-readable detail.
 * @param {object} [extra] - Extra Problem members.
 * @returns {Error} Boom error.
 */
function apiError(code, detail, extra = {}) {
  const body = officerProblem(code, detail, extra);
  const error = Boom.boomify(new Error(detail || body.title), { statusCode: body.status });
  error.data = { code, ...extra };
  return error;
}

module.exports = { OFFICER_ERROR_CODES, isKnownCode, officerProblem, apiError };
