const crypto = require('crypto');
const { S3Client } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { ApiError } = require('@/domain/errors');

const ALLOWED_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif'
});
const MAX_BYTES = 2 * 1024 * 1024;
const EXPIRES_SECONDS = 300;

/**
 * Presigned-POST issuer for event images (browser uploads straight to S3).
 * The policy pins key, content type and size, so a leaked URL cannot upload
 * anything else. SVG is deliberately not accepted (it can carry script).
 *
 * @param {object} options - Storage options.
 * @param {string} [options.bucket] - Assets bucket name.
 * @param {string} [options.assetBaseUrl] - Public CDN base URL the image is served from.
 * @param {string} [options.region] - AWS region.
 * @param {object} [options.s3] - S3 client (tests).
 * @param {Function} [options.presign] - createPresignedPost implementation (tests).
 * @returns {object} { createUpload({ eventId, contentType }), isEnabled }.
 */
function createImageUploads({ bucket, assetBaseUrl, region, s3, presign = createPresignedPost } = {}) {
  const client = s3 || (bucket ? new S3Client({ region: region || 'ap-southeast-3' }) : null);
  const base = assetBaseUrl ? assetBaseUrl.replace(/\/$/, '') : null;

  return {
    isEnabled: Boolean(client && base),

    async createUpload({ eventId, contentType }) {
      if (!client || !base) throw new ApiError('SERVICE_UNAVAILABLE', 'Image upload is not configured');
      const extension = ALLOWED_TYPES[contentType];
      if (!extension) throw new ApiError('VALIDATION_FAILED', 'content_type must be png, jpeg, webp or avif');
      const key = `events/${eventId}/hero-${crypto.randomBytes(6).toString('hex')}.${extension}`;
      const { url, fields } = await presign(client, {
        Bucket: bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, MAX_BYTES],
          ['eq', '$Content-Type', contentType]
        ],
        Fields: { 'Content-Type': contentType },
        Expires: EXPIRES_SECONDS
      });
      return {
        upload_url: url,
        fields,
        image_url: `${base}/${key}`,
        max_bytes: MAX_BYTES,
        expires_in: EXPIRES_SECONDS
      };
    }
  };
}

module.exports = { createImageUploads, ALLOWED_TYPES, MAX_BYTES };
