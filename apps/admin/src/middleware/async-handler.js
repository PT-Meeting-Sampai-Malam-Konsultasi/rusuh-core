/**
 * Wraps async route handlers so a rejected promise is forwarded to the
 * Express error handler (Express 4 does not catch async rejections).
 * Controllers stay clean (they just throw ApiError); this wrapper turns
 * the rejection into next(error).
 *
 * @param {Function} fn - Async route handler (request, response).
 * @returns {Function} Express handler (request, response, next).
 */
function asyncHandler(fn) {
  return (request, response, next) => {
    Promise.resolve(fn(request, response, next)).catch(next);
  };
}

/**
 * Wraps every method of a controller object with asyncHandler.
 *
 * @param {object} controller - Controller object (async methods).
 * @returns {object} Wrapped controller.
 */
function wrapController(controller) {
  const wrapped = {};
  Object.entries(controller).forEach(([name, fn]) => {
    wrapped[name] = asyncHandler(fn);
  });
  return wrapped;
}

module.exports = { asyncHandler, wrapController };
