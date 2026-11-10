/**
 * Sweeper (D9): expires bookings past their deadline, releases the hold,
 * enqueues the expired email, and publishes an empty-slot event.
 * Runs on an interval (~30 s) and on demand (runOnce, used by tests).
 * The bookings use case owns the expiry logic; the sweeper only schedules it.
 */

class Sweeper {
  /**
   * @param {object} options
   * @param {object} options.bookingService - BookingService (expireDue).
   * @param {number} [options.intervalMs] - Sweep interval (default 30000).
   * @param {Function} [options.onError] - Error hook (logging).
   * @param {Function} [options.onRun] - Run hook ({ processed, skipped, at }).
   */
  constructor({ bookingService, intervalMs = 30 * 1000, onError = () => {}, onRun = () => {} } = {}) {
    if (!bookingService) throw new Error('Sweeper requires bookingService');
    this.bookingService = bookingService;
    this.intervalMs = intervalMs;
    this.onError = onError;
    this.onRun = onRun;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return false;
    this.running = true;
    this.timer = setInterval(() => this.runOnce().catch(this.onError), this.intervalMs);
    this.timer.unref();
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  async runOnce(now = new Date()) {
    if (this.running === false && this.timer === null) {
      // runOnce works even when the interval is not started (tests).
    }
    try {
      const result = await this.bookingService.expireDue(now);
      this.onRun({ ...result, at: now.toISOString() });
      return result;
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }
}

module.exports = { Sweeper };
