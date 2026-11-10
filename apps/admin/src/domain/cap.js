/**
 * CAP domain (CAP final v1, 1 Nov; model event, ADR-0022). Pure
 * functions only — no I/O, no framework, no infrastructure.
 * The CAP lives in the event model (Postgres), never in Valkey;
 * core uses the effective CAP to compute empty slots + publish
 * empty-slot events.
 */

/** CAP tier multipliers (D7): 1x / 3x / 10x total stock. */
const CAP_TIERS = Object.freeze({ 1: 1, 3: 3, 10: 10 });

/**
 * Effective CAP = min(chosen cap, infra cap).
 * infra_cap is the load-test breaking point x 0.75. When infra_cap is
 * not set, the chosen cap is the effective cap.
 *
 * @param {number|null} cap - Chosen cap.
 * @param {number|null} infraCap - Infra cap.
 * @returns {number|null} Effective cap.
 */
function effectiveCap(cap, infraCap) {
  if (cap === null || cap === undefined) return null;
  if (infraCap === null || infraCap === undefined) return cap;
  return Math.min(cap, infraCap);
}

/**
 * Total stock of an event = sum of its category totals.
 *
 * @param {object} event - Event with categories.
 * @returns {number} Total stock.
 */
function totalStock(event) {
  return (event.categories || []).reduce((sum, category) => sum + category.total, 0);
}

module.exports = { CAP_TIERS, effectiveCap, totalStock };
