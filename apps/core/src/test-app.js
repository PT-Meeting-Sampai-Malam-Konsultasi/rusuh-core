const { loadEnvironment } = require('./infrastructure/config/environment');
const { createApp } = require('./app');
const { createDefaultDeps } = require('./container');
const { MemoryStore } = require('./infrastructure/persistence/store');
const { MemoryStock } = require('./infrastructure/cache/stock');
const { MemoryEventBus } = require('./infrastructure/messaging/events');
const {
  createRequireAccount,
  createRequireAdmission,
  createRequireAccountOrAdmission,
  createRequireServiceKey
} = require('./presentation/http/middleware/auth');

/**
 * Builds a test app with stub adapters (no live DB, Valkey, SQS, or AWS).
 * The account verifier accepts any Bearer token and returns a fixed account
 * (unless `accountSub` is null, in which case it rejects). The Dukcapil and
 * payment clients are stubs whose behaviour the caller can configure.
 *
 * @param {object} [options]
 * @param {string} [options.accountSub] - Account id for the stub verifier (default 'acc_01').
 * @param {boolean} [options.dukcapilValid] - Dukcapil verdict (default true).
 * @param {string} [options.dukcapilReason] - Dukcapil reason when invalid.
 * @param {object} [options.payment] - Payment stub ({ snapToken, status, grossAmount }).
 * @param {object} [options.admission] - Admission entry to seed in the stock.
 * @param {string} [options.serviceKey] - Service key for the internal endpoint.
 * @returns {Promise<{app: object, deps: object, admissionToken: string, accountToken: string}>}
 */
async function createTestApp({
  accountSub = 'acc_01',
  dukcapilValid = true,
  dukcapilReason = null,
  payment = {},
  admission = null,
  serviceKey = 'test-service-key',
  eventAssets
} = {}) {
  const config = loadEnvironment({
    NODE_ENV: 'test',
    SERVICE_KEY: serviceKey,
    DUKCAPIL_URL: 'http://localhost:18082'
  });
  const store = new MemoryStore();
  const stock = new MemoryStock();
  const eventBus = new MemoryEventBus();

  const admissionToken = 'adm_test01JB2Y5W3N8Qm4sT7vY2xK9pL';
  const admissionEntry = admission || {
    user_id: accountSub,
    event_id: 'evt_2026_gbk',
    slot_id: 's_test01JB7Q9K2M',
    device_id: 'w_test01JB2Y5W3N8Qm4sT',
    max_tickets: 3,
    expires_at: new Date(Date.now() + 16 * 60 * 1000).toISOString()
  };
  await stock.setAdmission(admissionToken, admissionEntry, 16 * 60 * 1000);

  const dukcapil = {
    verify: async () => ({ valid: dukcapilValid, reason: dukcapilReason })
  };
  const accounts = {
    getAccount: async (id) => ({ id, email: 'buyer@example.com', locale: 'id', fullName: 'Edy Supardi' })
  };
  const paymentStub = {
    isStub: false,
    createSnap: async ({ orderId }) => ({
      orderId,
      snapToken: payment.snapToken || 'stub-snap-token',
      redirectUrl: payment.redirectUrl || `https://pay.rusuh.id/start?order_id=${orderId}`
    }),
    getStatus: async () =>
      payment.status || { status: 'pending', grossAmount: 0, transactionId: null, paymentType: null },
    expire: async () => {}
  };

  const verify = async (token) => {
    if (!token || token === 'bad-token') {
      const error = new Error('Bad signature');
      error.code = 'UNAUTHORIZED';
      throw error;
    }
    // A distinct token for a second account (ownership tests).
    const sub = token === 'other-account-token' ? 'acc_other' : accountSub;
    return { sub, jti: 'jti-test', exp: Math.floor(Date.now() / 1000) + 900, iat: Math.floor(Date.now() / 1000) };
  };
  const auth = {
    requireAccount: createRequireAccount({ verify }),
    requireAdmission: createRequireAdmission({ stock, retryMs: 10, retryIntervalMs: 5 }),
    requireAccountOrAdmission: createRequireAccountOrAdmission({ verify, stock, retryMs: 10, retryIntervalMs: 5 }),
    requireServiceKey: createRequireServiceKey({ serviceKey })
  };

  const deps = createDefaultDeps(config, {
    store,
    stock,
    dukcapil,
    payment: paymentStub,
    eventBus,
    accounts,
    auth,
    eventAssets
  });
  const app = createApp({ config, deps });
  return { app, deps, admissionToken, accountToken: 'test-account-token' };
}

module.exports = { createTestApp };
