const { createMetrics } = require('../metrics');

describe('createMetrics', () => {
  it('starts at 0 and increments by 1 by default', () => {
    const metrics = createMetrics();
    expect(metrics.get('webhook_received')).toBe(0);
    metrics.increment('webhook_received');
    expect(metrics.get('webhook_received')).toBe(1);
    metrics.increment('webhook_received');
    expect(metrics.get('webhook_received')).toBe(2);
  });

  it('increments by a custom amount', () => {
    const metrics = createMetrics();
    metrics.increment('amount_mismatch_count', 5);
    expect(metrics.get('amount_mismatch_count')).toBe(5);
    metrics.increment('amount_mismatch_count', 3);
    expect(metrics.get('amount_mismatch_count')).toBe(8);
  });

  it('snapshots all counters as a plain object', () => {
    const metrics = createMetrics();
    metrics.increment('snap_created', 2);
    metrics.increment('get_status_calls');
    expect(metrics.snapshot()).toEqual({ snap_created: 2, get_status_calls: 1 });
    expect(metrics.snapshot()).toEqual({ snap_created: 2, get_status_calls: 1 });
  });
});
