const { ERROR_CODES, problem } = require('@rusuh/contracts');

/**
 * Extra Problem codes used by core-module that are not in @rusuh/contracts
 * (the yaml ErrorCode enum). Kept here (not in packages/*) because the
 * contracts package is shared across the monorepo.
 */
const EXTRA_CODES = Object.freeze({
  VALIDATION_FAILED: { status: 400, title: 'Data tidak valid' },
  ACCOUNT_HAS_ACTIVE_BOOKING: { status: 409, title: 'Anda masih punya pesanan aktif' },
  BOOKING_NOT_PAID: { status: 409, title: 'Pesanan belum dibayar' },
  RATE_LIMITED: { status: 429, title: 'Terlalu banyak permintaan' },
  INTERNAL_ERROR: { status: 500, title: 'Internal Server Error' }
});

const ALL_CODES = Object.freeze({ ...ERROR_CODES, ...EXTRA_CODES });

/**
 * Builds a Problem (RFC 9457) body for a repo error code.
 *
 * @param {string} code - Error code (repo ErrorCode enum).
 * @param {string} [detail] - Human-readable detail.
 * @param {object} [extra] - Extra Problem members (categoryId, traceId, ...).
 * @returns {object} Problem body.
 */
function problemBody(code, detail, extra = {}) {
  const known = ALL_CODES[code] || { status: 500, title: 'Internal Server Error' };
  return {
    type: `https://api.rusuh.id/problems/${code.toLowerCase().replace(/_/g, '-')}`,
    title: known.title,
    status: known.status,
    code,
    ...(detail ? { detail } : {}),
    ...extra
  };
}

/**
 * Creates an Error carrying a Problem body (caught by the error handler).
 *
 * @param {string} code - Error code.
 * @param {string} [detail] - Human-readable detail.
 * @param {object} [extra] - Extra Problem members.
 * @returns {Error} Error with .problem and .status.
 */
function problemError(code, detail, extra = {}) {
  const body = problemBody(code, detail, extra);
  const error = new Error(detail || body.title);
  error.problem = body;
  error.status = body.status;
  error.code = code;
  return error;
}

module.exports = { ALL_CODES, problemBody, problemError, problem };
