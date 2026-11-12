/**
 * Image uploads port: issues a presigned POST so the browser uploads an event
 * image straight to the assets bucket. Implemented by infrastructure/storage/image-uploads.js.
 *
 * @typedef {object} ImageUpload
 * @property {string} upload_url - URL the browser POSTs the multipart form to.
 * @property {object} fields - Form fields to send before the file.
 * @property {string} image_url - Public CDN URL to store on the event afterwards.
 * @property {number} max_bytes - Upper bound enforced by the signed policy.
 * @property {number} expires_in - Seconds until the signed policy expires.
 *
 * @typedef {object} ImageUploadsPort
 * @property {({eventId, contentType}: {eventId: string, contentType: string}) => Promise<ImageUpload>} createUpload
 *   Accepts png, jpeg, webp and avif only (SVG can carry script); throws VALIDATION_FAILED otherwise.
 */

module.exports = {};
