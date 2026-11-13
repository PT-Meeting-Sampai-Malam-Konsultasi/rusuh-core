const REFRESH_COOKIE = '__Host-rt';

// The __Host- prefix makes browsers drop the cookie unless it is Secure, has
// Path=/ and no Domain. Do not narrow the path (it was /v1/auth and the cookie
// was silently discarded).
const BASE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };

/**
 * Sets the web refresh token cookie (__Host-rt, HttpOnly, 7 days).
 *
 * @param {import('express').Response} response - Express response.
 * @param {string} refreshToken - Refresh token value.
 * @returns {void}
 */
function setRefreshCookie(response, refreshToken) {
  response.cookie(REFRESH_COOKIE, refreshToken, { ...BASE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

/**
 * Clears the web refresh token cookie with the same attributes it was set with.
 *
 * @param {import('express').Response} response - Express response.
 * @returns {void}
 */
function clearRefreshCookie(response) {
  response.clearCookie(REFRESH_COOKIE, BASE_OPTIONS);
}

/**
 * Reads the refresh token cookie from a request.
 *
 * @param {import('express').Request} request - Express request.
 * @returns {string|undefined} Cookie value, when present.
 */
function readRefreshCookie(request) {
  return request.cookies?.[REFRESH_COOKIE];
}

module.exports = { REFRESH_COOKIE, setRefreshCookie, clearRefreshCookie, readRefreshCookie };
