const crypto = require('crypto');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { resolveEncryptionKey } = require('@/domain/nik');
const { createEventsUseCase } = require('@/application/events/events.use-case');
const { createAttendeesUseCase } = require('@/application/attendees/attendees.use-case');
const { createBookingUseCase } = require('@/application/bookings/bookings.use-case');
const { createTicketsUseCase } = require('@/application/tickets/tickets.use-case');
const {
  createRequireAccount,
  createRequireAdmission,
  createRequireAccountOrAdmission,
  createRequireServiceKey,
  mayAccessBooking
} = require('@/presentation/http/middleware/auth');
const { MemoryStore, PgStore } = require('./infrastructure/persistence/store');
const { MemoryStock, RedisStock } = require('./infrastructure/cache/stock');
const { DukcapilClient } = require('./infrastructure/external/dukcapil');
const { PaymentClient } = require('./infrastructure/external/payment');
const { MemoryEventBus, SqsEventBus, AdmissionConsumer } = require('./infrastructure/messaging/events');
const { Sweeper } = require('./infrastructure/sweeper');

/**
 * Builds the core-module dependency graph.
 * Real adapters (Postgres / Valkey / SQS) are used when their URLs are set;
 * otherwise the in-memory (or stub) adapters are used, so the app boots and
 * the tests pass with no live infrastructure.
 */

/** Parses a JWKS JSON string into a kid -> JWK Map. */
function parseJwks(authJwks) {
  const jwks = JSON.parse(authJwks);
  return new Map(jwks.keys.map((key) => [key.kid, key]));
}

/** Builds the auth middleware set for a dependency graph. */
function buildAuth({ publicKeys, isDenied, stock, serviceKey }) {
  return {
    requireAccount: createRequireAccount({ publicKeys, isDenied }),
    requireAdmission: createRequireAdmission({ stock }),
    requireAccountOrAdmission: createRequireAccountOrAdmission({ publicKeys, isDenied, stock }),
    requireServiceKey: createRequireServiceKey({ serviceKey })
  };
}

/** Builds the business use cases for a dependency graph. */
function buildUseCases({
  store,
  stock,
  dukcapil,
  payment,
  eventBus,
  nikHmacKey,
  nikEncryptionKey,
  qrKey,
  fees,
  // Renamed locally: the module also imports mayAccessBooking (the guard
  // itself) for the default graph below; the parameter is the same function.
  mayAccessBooking: accessGuard
}) {
  return {
    events: createEventsUseCase({ store, stock, fees }),
    attendees: createAttendeesUseCase({ store, stock, dukcapil, nikHmacKey, nikEncryptionKey }),
    bookings: createBookingUseCase({
      store,
      stock,
      payment,
      eventBus,
      nikEncryptionKey,
      qrKey,
      fees,
      mayAccessBooking: accessGuard
    }),
    tickets: createTicketsUseCase({ store })
  };
}

function buildWorkers({ stock, bookingService, config }) {
  return {
    admissionConsumer: new AdmissionConsumer({
      stock,
      client: null,
      queueUrl: config.sqsAdmissionQueueUrl,
      ttlMs: config.admissionTtlMs,
      onError: (error) => console.error('[core] admission consumer error:', error.message)
    }),
    sweeper: new Sweeper({
      bookingService,
      intervalMs: config.sweepIntervalMs,
      onError: (error) => console.error('[core] sweeper error:', error.message),
      onRun: (result) => {
        if (result.processed > 0) console.info('[core] sweeper:', JSON.stringify(result));
      }
    })
  };
}

/**
 * Synchronous default graph (in-memory store/stock/event bus, stub payment
 * when PAYMENT_URL is unset). Used by createApp when no deps are injected.
 *
 * @param {object} config - Validated config (loadEnvironment).
 * @param {object} [overrides] - Adapter overrides (tests inject stubs).
 * @returns {object} Dependency graph.
 */
function createDefaultDeps(config, overrides = {}) {
  const warn = (message) => {
    if (config.nodeEnv !== 'test') console.warn(`[core] ${message}`);
  };
  const nikEncryptionKey = resolveEncryptionKey(config.nikEncryptionKey);
  const store = overrides.store || new MemoryStore();
  const stock = overrides.stock || new MemoryStock();
  const dukcapil =
    overrides.dukcapil || new DukcapilClient({ baseUrl: config.dukcapilUrl, timeoutMs: config.dukcapilTimeoutMs });
  const payment = overrides.payment || new PaymentClient({ baseUrl: config.paymentUrl, serviceKey: config.serviceKey });
  if (payment.isStub) warn('PAYMENT_URL not set: payment client runs in stub mode.');
  const eventBus = overrides.eventBus || new MemoryEventBus();
  if (!overrides.eventBus && config.nodeEnv !== 'test') {
    warn('SQS queue URLs not set: using in-memory event bus (events are not delivered).');
  }

  let { publicKeys } = overrides;
  let devPrivateJwk = null;
  if (!publicKeys) {
    if (config.authJwks) {
      publicKeys = parseJwks(config.authJwks);
    } else {
      warn('AUTH_JWKS not set: generating a dev Ed25519 keypair (do NOT use in production).');
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      publicKeys = new Map([['dev-01', publicKey.export({ format: 'jwk' })]]);
      devPrivateJwk = privateKey.export({ format: 'jwk' });
    }
  }
  const isDenied = (jti) => stock.isDenied(jti);
  const useCases = buildUseCases({
    store,
    stock,
    dukcapil,
    payment,
    eventBus,
    nikHmacKey: config.nikHmacKey,
    nikEncryptionKey,
    qrKey: config.qrHmacKey,
    fees: config.fees,
    mayAccessBooking
  });
  const { auth: providedAuth } = overrides;
  const auth = providedAuth || buildAuth({ publicKeys, isDenied, stock, serviceKey: config.serviceKey });
  const workers = buildWorkers({ stock, bookingService: useCases.bookings, config });
  return {
    config,
    store,
    stock,
    dukcapil,
    payment,
    eventBus,
    publicKeys,
    devPrivateJwk,
    isDenied,
    nikEncryptionKey,
    // Booking-access guard (presentation layer, injected into the bookings
    // use case). Kept on the graph so createDeps rebuilds (which spread
    // ...deps into buildUseCases) keep it.
    mayAccessBooking,
    useCases,
    auth,
    ...workers
  };
}

/**
 * Async graph: upgrades the default adapters to the real ones when their
 * URLs are configured (Postgres, Valkey, SQS). Falls back to the default
 * graph for anything not configured.
 *
 * @param {object} config - Validated config (loadEnvironment).
 * @param {object} [overrides] - Adapter overrides (tests inject stubs).
 * @returns {Promise<object>} Dependency graph.
 */
async function createDeps(config, overrides = {}) {
  const deps = createDefaultDeps(config, overrides);
  if (config.databaseUrl && !overrides.store) {
    deps.store = await PgStore.connect(config.databaseUrl);
    deps.useCases = buildUseCases({ ...deps, store: deps.store });
    deps.sweeper = buildWorkers({ stock: deps.stock, bookingService: deps.useCases.bookings, config }).sweeper;
  }
  if (config.valkeyUrl && !overrides.stock) {
    deps.stock = await RedisStock.connect(config.valkeyUrl);
    deps.useCases = buildUseCases({ ...deps, stock: deps.stock });
    deps.auth = buildAuth({
      publicKeys: deps.publicKeys,
      isDenied: (jti) => deps.stock.isDenied(jti),
      stock: deps.stock,
      serviceKey: config.serviceKey
    });
    deps.sweeper = buildWorkers({ stock: deps.stock, bookingService: deps.useCases.bookings, config }).sweeper;
    deps.admissionConsumer = new AdmissionConsumer({
      stock: deps.stock,
      client: deps.admissionConsumer.client,
      queueUrl: config.sqsAdmissionQueueUrl,
      ttlMs: config.admissionTtlMs,
      onError: (error) => console.error('[core] admission consumer error:', error.message)
    });
  }
  if (config.sqsEmptySlotQueueUrl && config.sqsNotificationQueueUrl && !overrides.eventBus) {
    deps.eventBus = await SqsEventBus.create({
      region: config.awsRegion,
      emptySlotQueueUrl: config.sqsEmptySlotQueueUrl,
      notificationQueueUrl: config.sqsNotificationQueueUrl
    });
    deps.useCases = buildUseCases({ ...deps, eventBus: deps.eventBus });
    deps.sweeper = buildWorkers({ stock: deps.stock, bookingService: deps.useCases.bookings, config }).sweeper;
    if (config.sqsAdmissionQueueUrl) {
      deps.admissionConsumer = new AdmissionConsumer({
        stock: deps.stock,
        client: new SQSClient({ region: config.awsRegion }),
        queueUrl: config.sqsAdmissionQueueUrl,
        ttlMs: config.admissionTtlMs,
        onError: (error) => console.error('[core] admission consumer error:', error.message)
      });
    }
  }
  return deps;
}

module.exports = { createDeps, createDefaultDeps };
