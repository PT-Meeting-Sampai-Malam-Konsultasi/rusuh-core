const { createImageUploads, MAX_BYTES } = require('@/infrastructure/storage/image-uploads');

describe('createImageUploads', () => {
  const build = (presign) =>
    createImageUploads({ bucket: 'assets', assetBaseUrl: 'https://cdn.rusuh.id/', s3: {}, presign });

  it('pins key, type and size in the policy and returns the public image_url', async () => {
    const presign = jest.fn().mockResolvedValue({ url: 'https://s3/assets', fields: { key: 'k' } });
    const result = await build(presign).createUpload({ eventId: 'evt_1', contentType: 'image/webp' });
    const args = presign.mock.calls[0][1];
    expect(args.Bucket).toBe('assets');
    expect(args.Key).toMatch(/^events\/evt_1\/hero-[0-9a-f]{12}\.webp$/);
    expect(args.Conditions).toEqual([
      ['content-length-range', 1, MAX_BYTES],
      ['eq', '$Content-Type', 'image/webp']
    ]);
    expect(result.image_url).toBe(`https://cdn.rusuh.id/${args.Key}`);
    expect(result.upload_url).toBe('https://s3/assets');
  });

  it('rejects SVG and any non-image type', async () => {
    const uploads = build(jest.fn());
    await expect(uploads.createUpload({ eventId: 'e', contentType: 'image/svg+xml' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    });
    await expect(uploads.createUpload({ eventId: 'e', contentType: 'text/html' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    });
  });

  it('is unavailable without bucket and asset base URL', async () => {
    const uploads = createImageUploads({});
    expect(uploads.isEnabled).toBe(false);
    await expect(uploads.createUpload({ eventId: 'e', contentType: 'image/png' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE'
    });
  });
});
