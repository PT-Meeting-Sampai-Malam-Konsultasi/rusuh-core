const { QueueFeedWorker } = require('@/infrastructure/queue-feed-worker');

function stubFeed({ sync = async () => ({ listed: [], added: [], removed: [] }), relay = async () => 0 } = {}) {
  return { sync: jest.fn(sync), relay: jest.fn(relay) };
}

describe('QueueFeedWorker', () => {
  afterEach(() => jest.useRealTimers());

  it('requires the queue feed use case', () => {
    expect(() => new QueueFeedWorker()).toThrow('QueueFeedWorker requires queueFeed');
  });

  it('syncs and relays on their own intervals once started, and stops', async () => {
    jest.useFakeTimers();
    const queueFeed = stubFeed();
    const worker = new QueueFeedWorker({ queueFeed, syncIntervalMs: 5000, relayIntervalMs: 1000 });
    expect(worker.start()).toBe(true);
    expect(worker.start()).toBe(false);
    await jest.advanceTimersByTimeAsync(5000);
    expect(queueFeed.sync).toHaveBeenCalledTimes(1);
    expect(queueFeed.relay).toHaveBeenCalledTimes(5);
    worker.stop();
    await jest.advanceTimersByTimeAsync(10000);
    expect(queueFeed.sync).toHaveBeenCalledTimes(1);
  });

  it('never overlaps a run with the previous one', async () => {
    let finish;
    const queueFeed = stubFeed({
      relay: () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    });
    const worker = new QueueFeedWorker({ queueFeed });
    const first = worker.relayOnce();
    expect(await worker.relayOnce()).toBeNull();
    finish(3);
    expect(await first).toBe(3);
    expect(queueFeed.relay).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run and keeps going', async () => {
    const onError = jest.fn();
    const queueFeed = stubFeed({
      sync: async () => {
        throw new Error('valkey down');
      }
    });
    const worker = new QueueFeedWorker({ queueFeed, onError });
    expect(await worker.syncOnce()).toBeNull();
    expect(onError).toHaveBeenCalledWith('sync', expect.objectContaining({ message: 'valkey down' }));
    await worker.syncOnce();
    expect(queueFeed.sync).toHaveBeenCalledTimes(2);
  });

  it('passes each successful run to onRun', async () => {
    const onRun = jest.fn();
    const worker = new QueueFeedWorker({ queueFeed: stubFeed({ relay: async () => 2 }), onRun });
    await worker.relayOnce();
    expect(onRun).toHaveBeenCalledWith('relay', 2);
  });
});
