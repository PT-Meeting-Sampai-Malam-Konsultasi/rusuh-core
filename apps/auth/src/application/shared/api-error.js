const Boom = require('@hapi/boom');
const { ERROR_CODES, problem } = require('@rusuh/contracts');

/** Generic (non-repo) Problem codes, by HTTP status. */
const GENERIC_CODES = Object.freeze({
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE'
});

/** HTTP status for a generic Problem code. */
const GENERIC_STATUS = Object.freeze({
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
});

/** Titles for the generic Problem codes. */
const GENERIC_TITLES = Object.freeze({
  BAD_REQUEST: 'Bad Request',
  UNAUTHORIZED: 'Unauthorized',
  NOT_FOUND: 'Not Found',
  CONFLICT: 'Conflict',
  TOO_MANY_REQUESTS: 'Too Many Requests',
  INTERNAL_ERROR: 'Internal Server Error',
  SERVICE_UNAVAILABLE: 'Service Unavailable'
});

/**
 * Creates an API error carrying a repo error code (openapi.yaml, RFC 9457
 * Problem). The error-handler middleware renders it as Problem JSON.
 *
 * @param {string} code - A @rusuh/contracts ERROR_CODE or a generic code.
 * @param {string} [detail] - Human-readable detail (Indonesian default).
 * @param {object} [extra] - Extra Problem members (e.g. attemptsLeft).
 * @returns {Error} Boom error with the repo code in `data`.
 */
function apiError(code, detail, extra = {}) {
  const known = ERROR_CODES[code];
  const status = known ? known.status : GENERIC_STATUS[code] || 500;
  const message = detail || known?.title || code;
  const error = Boom.boomify(new Error(message), { statusCode: status });
  error.data = { code, ...extra };
  return error;
}

/**
 * Renders any thrown error as RFC 9457 Problem JSON.
 *
 * @param {Error} error - Thrown error.
 * @param {string} [traceId] - Correlation/request id for the Problem traceId.
 * @returns {{status: number, body: object}} HTTP status + Problem body.
 */
function toProblem(error, traceId) {
  const data = error?.data || {};
  if (data.code && ERROR_CODES[data.code]) {
    const { code, ...extra } = data;
    const body = problem(code, error.message, extra);
    if (traceId) body.traceId = traceId;
    return { status: body.status, body };
  }

  const status = Boom.isBoom(error) ? error.output.statusCode : 500;
  const code = GENERIC_CODES[status] || 'INTERNAL_ERROR';
  // Build the body directly: @rusuh/contracts problem() only knows the repo
  // ERROR_CODES, so a generic code would fall back to a 500 body.
  const body = {
    type: 'about:blank',
    title: GENERIC_TITLES[code] || 'Internal Server Error',
    status,
    code,
    detail: error.message || 'An unexpected error occurred'
  };
  if (traceId) body.traceId = traceId;
  return { status, body };
}

module.exports = { apiError, toProblem };
