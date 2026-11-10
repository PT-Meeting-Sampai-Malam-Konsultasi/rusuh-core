const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/**
 * Creates a thin S3 adapter (read ticket PDFs + presigned download links).
 * The underlying client is injectable so tests run without live AWS.
 *
 * @param {object} options - Adapter dependencies.
 * @param {string} options.region - AWS region.
 * @param {object} [options.client] - Prebuilt S3 client (tests).
 * @param {Function} [options.signer] - Presigned-URL signer (tests).
 * @returns {object} S3 adapter.
 */
function createS3Adapter({ region, client = new S3Client({ region }), signer = getSignedUrl } = {}) {
  if (!region) throw new Error('createS3Adapter requires a region');

  return {
    /**
     * Downloads an object as a Buffer.
     *
     * @param {string} bucket - Bucket name.
     * @param {string} key - Object key.
     * @returns {Promise<Buffer>} Object bytes.
     */
    getObject: async (bucket, key) => {
      const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!output.Body) throw new Error(`S3 object is empty: s3://${bucket}/${key}`);
      if (typeof output.Body.transformToByteArray === 'function') {
        return Buffer.from(await output.Body.transformToByteArray());
      }
      return new Promise((resolve, reject) => {
        const chunks = [];
        output.Body.on('data', (chunk) => chunks.push(chunk));
        output.Body.on('error', reject);
        output.Body.on('end', () => resolve(Buffer.concat(chunks)));
      });
    },

    /**
     * Builds a presigned GET URL for an object.
     *
     * @param {string} bucket - Bucket name.
     * @param {string} key - Object key.
     * @param {number} [expiresInSeconds] - URL lifetime (default 7 days, LLD-02 §10).
     * @returns {Promise<string>} Presigned URL.
     */
    presignedGetUrl: async (bucket, key, expiresInSeconds = 7 * 24 * 60 * 60) => {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return signer(client, command, { expiresIn: expiresInSeconds });
    }
  };
}

module.exports = { createS3Adapter };
