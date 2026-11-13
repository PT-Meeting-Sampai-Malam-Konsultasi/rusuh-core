const { Readable } = require('stream');
const request = require('supertest');
const { createTestApp } = require('@/test-app');

describe('GET /v1/core/assets/events/:eventId/hero', () => {
  it('streams an event hero with browser cache headers', async () => {
    const { app } = await createTestApp({
      eventAssets: {
        getHero: async () => ({
          body: Readable.from(Buffer.from('hero')),
          contentType: 'image/jpeg',
          contentLength: 4,
          eTag: '"asset-tag"'
        })
      }
    });
    const response = await request(app).get('/v1/core/assets/events/evt_2026_gbk/hero');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
    expect(response.headers.etag).toBe('"asset-tag"');
    expect(response.body.toString()).toBe('hero');
  });
});
