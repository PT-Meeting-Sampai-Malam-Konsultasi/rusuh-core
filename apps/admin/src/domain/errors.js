const { problem } = require('@rusuh/contracts');

/**
 * API error carrying a repo Problem code (openapi.yaml, RFC 9457).
 * Controllers/services throw ApiError; the problem-handler renders it.
 */
class ApiError extends Error {
  /**
   * @param {string} code - One of @rusuh/contracts ERROR_CODES (or FORBIDDEN).
   * @param {string} [detail] - Human-readable detail.
   * @param {object} [extra] - Extra Problem members.
   */
  constructor(code, detail, extra = {}) {
    super(detail || code);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
}

/**
 * Builds a Problem (RFC 9457) body for an ApiError or a plain code.
 * VALIDATION_FAILED (400), FORBIDDEN (403, wrong role) and
 * SERVICE_UNAVAILABLE (503, a downstream service is unreachable) have
 * no entry in @rusuh/contracts ERROR_CODES yet (the yaml ErrorCode enum
 * has VALIDATION_FAILED) — they are rendered here so the gap is visible
 * (see report).
 *
 * @param {string} code - Error code.
 * @param {string} [detail] - Human-readable detail.
 * @param {object} [extra] - Extra Problem members.
 * @returns {object} Problem body.
 */
function problemBody(code, detail, extra = {}) {
  if (code === 'VALIDATION_FAILED') {
    return {
      type: 'about:blank',
      title: 'Validation failed',
      status: 400,
      code: 'VALIDATION_FAILED',
      ...(detail ? { detail } : {}),
      ...extra
    };
  }
  if (code === 'FORBIDDEN') {
    return {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      code: 'FORBIDDEN',
      ...(detail ? { detail } : {}),
      ...extra
    };
  }
  if (code === 'SERVICE_UNAVAILABLE') {
    return {
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      ...(detail ? { detail } : {}),
      ...extra
    };
  }
  return problem(code, detail, extra);
}

/**
 * HTTP status for a Problem code.
 *
 * @param {string} code - Error code.
 * @returns {number} HTTP status.
 */
function statusFor(code) {
  if (code === 'VALIDATION_FAILED') return 400;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'SERVICE_UNAVAILABLE') return 503;
  const body = problem(code);
  return body.status;
}

module.exports = { ApiError, problemBody, statusFor };
