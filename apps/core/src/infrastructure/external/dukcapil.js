/**
 * Dukcapil verification client (rusuh-mock contract).
 *  POST {baseUrl}/api/v1/verifications { nik } -> 200 { data: { nik, valid, reason } }
 * Format-only verification: the mock checks the NIK format (16 digits,
 * valid birth date, sequence != 0000); it does NOT look the NIK up in a
 * dataset. Malformed NIK -> 400 (or valid:false). A format-valid NIK is
 * valid:true, whatever its value.
 * Timeout 2 s (LLD-02 §5.1). Circuit breaker: after N consecutive failures
 * the circuit opens for a cooldown and verify() throws DUKCAPIL_UNAVAILABLE
 * without calling the service (503, LLD-02 §5.1).
 * A negative verdict (valid:false) BLOCKS the purchase (gating, 6 Nov item 4).
 */

const { createOutboundHeaders, reportHttpFailure } = require('@rusuh/observability');

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30 * 1000;

class DukcapilClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl - Mock/real Dukcapil base URL.
   * @param {number} [options.timeoutMs] - Per-call timeout (default 2000).
   * @param {number} [options.failureThreshold] - Failures before the circuit opens.
   * @param {number} [options.cooldownMs] - Circuit-open cooldown.
   * @param {Function} [options.fetchImpl] - fetch implementation (tests inject a stub).
   */
  constructor({
    baseUrl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    fetchImpl = fetch,
    logger
  } = {}) {
    this.logger = logger;
    if (!baseUrl) throw new Error('DukcapilClient requires baseUrl');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.fetchImpl = fetchImpl;
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = 0;
  }

  isCircuitOpen(now = Date.now()) {
    if (this.circuitOpenedAt === 0) return false;
    if (now - this.circuitOpenedAt >= this.cooldownMs) {
      this.circuitOpenedAt = 0;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  _recordSuccess() {
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = 0;
  }

  _recordFailure(now = Date.now()) {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) this.circuitOpenedAt = now;
  }

  /**
   * Verifies one NIK (format + existence).
   *
   * @param {string} nik - 16-digit NIK.
   * @returns {Promise<{valid: boolean, reason: string|null}>}
   * @throws {Error} code DUKCAPIL_UNAVAILABLE when the service cannot be reached
   *   or the circuit is open.
   */
  async verify(nik) {
    if (this.isCircuitOpen()) {
      const error = new Error('Dukcapil is unavailable; try again.');
      error.code = 'DUKCAPIL_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    const controller = new AbortController();
    let timedOut = false;
    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/verifications`, {
        method: 'POST',
        headers: createOutboundHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ nik }),
        signal: controller.signal
      });
      if (!response.ok) {
        // 400 = malformed NIK (a verdict, not an outage): valid:false.
        if (response.status === 400) {
          this._recordSuccess();
          return { valid: false, reason: 'NIK_INVALID' };
        }
        const upstreamError = new Error(`Dukcapil responded ${response.status}`);
        upstreamError.status = response.status;
        throw upstreamError;
      }
      const body = await response.json();
      this._recordSuccess();
      return { valid: Boolean(body?.data?.valid), reason: body?.data?.reason || null };
    } catch (error) {
      if (error?.code === 'DUKCAPIL_UNAVAILABLE') throw error;
      this._recordFailure();
      reportHttpFailure({
        logger: this.logger,
        service: 'dukcapil',
        operation: 'verify',
        error,
        timedOut,
        startedAt
      });
      const unavailable = new Error('Dukcapil is unavailable; try again.');
      unavailable.code = 'DUKCAPIL_UNAVAILABLE';
      unavailable.status = 503;
      unavailable.cause = error;
      throw unavailable;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { DukcapilClient };
