const { Sweeper } = require('@/infrastructure/sweeper');

describe('Sweeper (D9)', () => {
  const result = { processed: 2, skipped: 1 };

  function stubBookingService({ expireDue = async () => result } = {}) {
    return { expireDue: jest.fn(expireDue) };
  }

  it('requires a bookingService', () => {
    expect(() => new Sweeper({})).toThrow('Sweeper requires bookingService');
    expect(() => new Sweeper()).toThrow('Sweeper requires bookingService');
  });

  it('runOnce calls expireDue and the onRun hook, and returns the result', async () => {
    const bookingService = stubBookingService();
    const onRun = jest.fn();
    const sweeper = new Sweeper({ bookingService, onRun });
    const now = new Date('2026-11-07T10:00:00.000Z');
    const returned = await sweeper.runOnce(now);
    expect(returned).toEqual(result);
    expect(bookingService.expireDue).toHaveBeenCalledWith(now);
    expect(onRun).toHaveBeenCalledWith({ ...result, at: now.toISOString() });
  });

  it('runOnce works even when the interval is not started', async () => {
    const sweeper = new Sweeper({ bookingService: stubBookingService() });
    await expect(sweeper.runOnce()).resolves.toEqual(result);
  });

  it('runOnce calls onError and rethrows when expireDue fails', async () => {
    const error = new Error('store down');
    const bookingService = stubBookingService({
      expireDue: async () => {
        throw error;
      }
    });
    const onError = jest.fn();
    const sweeper = new Sweeper({ bookingService, onError });
    await expect(sweeper.runOnce()).rejects.toThrow('store down');
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('start returns true once, then false while running; stop clears it', async () => {
    const sweeper = new Sweeper({ bookingService: stubBookingService(), intervalMs: 60000 });
    expect(sweeper.start()).toBe(true);
    expect(sweeper.running).toBe(true);
    expect(sweeper.start()).toBe(false);
    sweeper.stop();
    expect(sweeper.running).toBe(false);
    expect(sweeper.timer).toBeNull();
    // After stop, start works again.
    expect(sweeper.start()).toBe(true);
    sweeper.stop();
  });

  it('the interval calls runOnce and routes errors to onError', async () => {
    const error = new Error('interval failure');
    const bookingService = stubBookingService({
      expireDue: async () => {
        throw error;
      }
    });
    const onError = jest.fn();
    const sweeper = new Sweeper({ bookingService, intervalMs: 10, onError });
    sweeper.start();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    sweeper.stop();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
