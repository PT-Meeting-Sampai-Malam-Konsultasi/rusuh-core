/**
 * Stock seeder port: initializes live stock counters for new categories so
 * they do not read as sold out. Implemented by infrastructure/stock/valkey-stock.js.
 * Key layout is core's: stock:{eventId}:{categoryId}:available|held|sold,
 * with the invariant available + held + sold = total. Idempotent (SET NX).
 *
 * @typedef {object} StockSeederPort
 * @property {(eventId: string, categories: Array<{category_id: string, total: number}>) => Promise<void>} seedCategories
 *   Seeds the three counters per category; never overwrites counters that already moved.
 */

module.exports = {};
