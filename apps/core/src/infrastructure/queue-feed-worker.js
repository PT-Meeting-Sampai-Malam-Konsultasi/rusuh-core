/**
 * Runs the queue feed (BR-06-C1) in the background: sync (sale, stock and the
 * event list) every syncIntervalMs and the outbox relay every relayIntervalMs.
 * Every core task runs it; the writes are idempotent and the relay locks its
 * rows, so tasks never send a booking event twice at once.
 */
class QueueFeedWorker {
  /**
   * @param {object} options
   * @param {object} options.queueFeed - Queue feed use case (sync, relay).
   * @param {number} [options.syncIntervalMs] - Default 5000.
   * @param {number} [options.relayIntervalMs] - Default 1000.
   * @param {Function} [options.onError] - (job, error).
   * @param {Function} [options.onRun] - (job, result).
   */
  constructor({ queueFeed, syncIntervalMs = 5000, relayIntervalMs = 1000, onError = () => {}, onRun = () => {} } = {}) {
    if (!queueFeed) throw new Error('QueueFeedWorker requires queueFeed');
    this.queueFeed = queueFeed;
    this.syncIntervalMs = syncIntervalMs;
    this.relayIntervalMs = relayIntervalMs;
    this.onError = onError;
    this.onRun = onRun;
    this.timers = [];
    this.busy = new Set();
  }

  start() {
    if (this.timers.length > 0) return false;
    this.timers = [
      setInterval(() => this.syncOnce(), this.syncIntervalMs),
      setInterval(() => this.relayOnce(), this.relayIntervalMs)
    ];
    this.timers.forEach((timer) => timer.unref());
    return true;
  }

  stop() {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];
  }

  syncOnce(now = new Date()) {
    return this._run('sync', () => this.queueFeed.sync(now));
  }

  relayOnce() {
    return this._run('relay', () => this.queueFeed.relay());
  }

  /** Runs a job unless its previous run is still going; null when skipped or failed. */
  async _run(job, fn) {
    if (this.busy.has(job)) return null;
    this.busy.add(job);
    try {
      const result = await fn();
      this.onRun(job, result);
      return result;
    } catch (error) {
      this.onError(job, error);
      return null;
    } finally {
      this.busy.delete(job);
    }
  }
}

module.exports = { QueueFeedWorker };
