const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');

/**
 * Reads public event hero assets from the private application bucket.
 *
 * @param {object} options - Asset storage configuration.
 * @param {string|null} [options.bucket] - S3 bucket containing event assets.
 * @param {string} options.region - AWS region for the bucket.
 * @param {S3Client} [options.client] - Injectable S3 client.
 * @returns {object} Event asset reader.
 */
function createEventAssets({ bucket, region, client = new S3Client({ region }) } = {}) {
  return {
    /**
     * Fetches an event hero image from the private bucket.
     *
     * @param {string} eventId - Event identifier used in the object key.
     * @returns {Promise<{body: import('stream').Readable, contentType: string, contentLength: number|undefined, eTag: string|undefined}>} Asset response.
     */
    async getHero(eventId) {
      if (!bucket) return null;
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `events/${eventId}/hero.jpg` }));
        return {
          body: object.Body,
          contentType: object.ContentType || 'image/jpeg',
          contentLength: object.ContentLength,
          eTag: object.ETag
        };
      } catch (error) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    }
  };
}

module.exports = { createEventAssets };
