const { problemError } = require('@/domain/problem');
const { eventIdParam } = require('../validation/events.validation');

/**
 * Creates controllers that serve browser-safe public event assets.
 *
 * @param {object} assets - Private event asset reader.
 * @returns {object} Asset endpoint controllers.
 */
function createAssetsController(assets) {
  return {
    /**
     * Streams an event hero image from private S3 storage with public cache headers.
     *
     * @param {import('express').Request} request - HTTP request with an event id.
     * @param {import('express').Response} response - HTTP response.
     * @param {Function} next - Express error continuation.
     * @returns {Promise<void>} Completes the image response.
     */
    async getEventHero(request, response, next) {
      try {
        const { error } = eventIdParam.validate(request.params);
        if (error) throw problemError('VALIDATION_FAILED', 'One or more fields are missing or malformed.');
        const asset = await assets.getHero(request.params.eventId);
        if (!asset) throw problemError('NOT_FOUND', 'No such resource for this caller.');
        response.set({
          'Cache-Control': 'public, max-age=86400',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Content-Type': asset.contentType,
          ...(asset.contentLength ? { 'Content-Length': String(asset.contentLength) } : {}),
          ...(asset.eTag ? { ETag: asset.eTag } : {})
        });
        asset.body.pipe(response);
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = { createAssetsController };
