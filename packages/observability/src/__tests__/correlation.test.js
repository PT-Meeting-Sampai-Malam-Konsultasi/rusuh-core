const { correlationMiddleware } = require('../correlation');

describe('correlationMiddleware', () => {
  it('echoes the incoming correlation id and attaches it to the request', () => {
    const request = { headers: { 'x-correlation-id': 'req-123' } };
    const response = { setHeader: jest.fn() };
    correlationMiddleware(request, response, () => {});
    expect(request.correlationId).toBe('req-123');
    expect(response.setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'req-123');
  });

  it('generates one when absent', () => {
    const request = { headers: {} };
    const response = { setHeader: jest.fn() };
    correlationMiddleware(request, response, () => {});
    expect(typeof request.correlationId).toBe('string');
    expect(request.correlationId.length).toBeGreaterThan(0);
  });
});
