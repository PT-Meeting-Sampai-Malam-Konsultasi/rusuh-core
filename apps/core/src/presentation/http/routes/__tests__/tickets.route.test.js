const request = require('supertest');
const { createTestApp } = require('@/test-app');

describe('tickets', () => {
  it('returns an empty list when nothing is paid yet', async () => {
    const { app, accountToken } = await createTestApp();
    const response = await request(app).get('/v1/tickets').set('Authorization', `Bearer ${accountToken}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  it('returns 404 for a ticket that does not exist', async () => {
    const { app, accountToken } = await createTestApp();
    const response = await request(app).get('/v1/tickets/tk_missing').set('Authorization', `Bearer ${accountToken}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated request', async () => {
    const { app } = await createTestApp();
    const response = await request(app).get('/v1/tickets');
    expect(response.status).toBe(401);
  });
});
