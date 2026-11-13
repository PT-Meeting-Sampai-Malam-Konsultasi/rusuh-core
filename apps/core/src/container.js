const crypto = require('crypto');
const { resolveEncryptionKey } = require('@/domain/nik');
const { createEventsUseCase } = require('@/application/events/events.use-case');
const { createAttendeesUseCase } = require('@/application/attendees/attendees.use-case');
const { createBookingUseCase } = require('@/application/bookings/bookings.use-case');
const { createTicketsUseCase } = require('@/application/tickets/tickets.use-case');
const { createAdmissionUseCase } = require('@/application/admission/admission.use-case');
const { createQueueFeedUseCase } = require('@/application/queue-feed/queue-feed.use-case');
const {
  createRequireAccount,
  createRequireAdmission,
  createRequireAccountOrAdmission,
  createRequireServiceKey,
  mayAccessBooking
} = require('@/presentation/http/middleware/auth');
const { MemoryStore, PgStore } = require('./infrastructure/persistence/store');
const { MemoryStock, RedisStock } = require('./infrastructure/cache/stock');
const { MemoryQueueFeed, RedisQueueFeed } = require('./infrastructure/cache/queue-feed');
const { DukcapilClient } = require('./infrastructure/external/dukcapil');
const { PaymentClient } = require('./infrastructure/external/payment');
const { AuthClient } = require('./infrastructure/external/auth');
const { MemoryEventBus, SqsEventBus } = require('./infrastructure/messaging/events');
const { Sweeper } = require('./infrastructure/sweeper');
const { QueueFeedWorker } = require('./infrastructure/queue-feed-worker');

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
function buildAuth({ publicKeys, isDenied, stock, serviceKey, authAudience, authIssuer }) {
  return {
    requireAccount: createRequireAccount({ publicKeys, isDenied, expectedAud: authAudience, expectedIss: authIssuer }),
    requireAdmission: createRequireAdmission({ stock }),
    requireAccountOrAdmission: createRequireAccountOrAdmission({
      publicKeys,
      isDenied,
      stock,
      expectedAud: authAudience,
      expectedIss: authIssuer
    }),
    requireServiceKey: createRequireServiceKey({ serviceKey })
  };
}

/** Builds the business use cases for a dependency graph. */
function buildUseCases({
  store,
  stock,
  feed,
  dukcapil,
  payment,
  eventBus,
  accounts,
  emailConfig,
  nikHmacKey,
  nikEncryptionKey,
  qrKey,
  fees,
  admissionTtlMs,
  // Renamed locally: the module also imports mayAccessBooking (the guard
  // itself) for the default graph below; the parameter is the same function.
  mayAccessBooking: accessGuard
}) {
  const queueFeed = createQueueFeedUseCase({ store, feed });
  return {
    queueFeed,
    events: createEventsUseCase({ store, stock, fees }),
    attendees: createAttendeesUseCase({ store, stock, dukcapil, nikHmacKey, nikEncryptionKey }),
    bookings: createBookingUseCase({
      store,
      stock,
      payment,
      eventBus,
      queueFeed,
      accounts,
      emailConfig,
      nikEncryptionKey,
      qrKey,
      fees,
      mayAccessBooking: accessGuard
    }),
    tickets: createTicketsUseCase({ store }),
    admission: createAdmissionUseCase({ stock, ttlMs: admissionTtlMs })
  };
}

function buildWorkers({ bookingService, queueFeed, config }) {
  return {
    queueFeedWorker: new QueueFeedWorker({
      queueFeed,
      syncIntervalMs: config.queueFeedIntervalMs,
      relayIntervalMs: config.outboxRelayIntervalMs,
      onError: (job, error) => console.error(`[core] queue feed ${job} error:`, error.message),
      onRun: (job, result) => {
        if (job === 'relay' && result > 0) console.info('[core] queue feed relay:', result);
        if (job === 'sync' && (result.added.length > 0 || result.removed.length > 0)) {
          console.info('[core] queue feed listing:', JSON.stringify(result));
        }
      }
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
  const feed = overrides.feed || new MemoryQueueFeed({ counter: (key) => stock.counters?.get(key) });
  const dukcapil =
    overrides.dukcapil || new DukcapilClient({ baseUrl: config.dukcapilUrl, timeoutMs: config.dukcapilTimeoutMs });
  const payment = overrides.payment || new PaymentClient({ baseUrl: config.paymentUrl, serviceKey: config.serviceKey });
  if (payment.isStub) warn('PAYMENT_URL not set: payment client runs in stub mode.');
  const accounts = overrides.accounts || new AuthClient({ baseUrl: config.authUrl, serviceKey: config.serviceKey });
  if (accounts.isStub) warn('AUTH_URL not set: booking e-mails are skipped (no buyer e-mail lookup).');
  const emailConfig = {
    webBaseUrl: config.webBaseUrl,
    refundWindowLabel: config.refundWindowLabel
  };
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
    feed,
    dukcapil,
    payment,
    eventBus,
    accounts,
    emailConfig,
    nikHmacKey: config.nikHmacKey,
    nikEncryptionKey,
    qrKey: config.qrHmacKey,
    fees: config.fees,
    admissionTtlMs: config.admissionTtlMs,
    mayAccessBooking
  });
  const { auth: providedAuth } = overrides;
  const auth =
    providedAuth ||
    buildAuth({
      publicKeys,
      isDenied,
      stock,
      serviceKey: config.serviceKey,
      authAudience: config.authAudience,
      authIssuer: config.authIssuer
    });
  const workers = buildWorkers({ bookingService: useCases.bookings, queueFeed: useCases.queueFeed, config });
  return {
    config,
    store,
    stock,
    feed,
    dukcapil,
    payment,
    accounts,
    emailConfig,
    eventBus,
    publicKeys,
    devPrivateJwk,
    isDenied,
    nikEncryptionKey,
    // Booking-access guard (presentation layer, injected into the bookings
    // use case). Kept on the graph so createDeps rebuilds (which spread
    // ...deps into buildUseCases) keep it.
    mayAccessBooking,
    // Domain keys/config the use cases need (nikHmacKey, qrKey, fees,
    // admissionTtlMs). They live in config, but they are ALSO kept on the
    // graph top level so createDeps rebuilds (which spread ...deps into
    // buildUseCases) keep them. Without this, the rebuilds pass undefined
    // for all of them (the graph only had them nested under config), so
    // with real infra (Postgres/Valkey/SQS) the rebuilt attendees use case
    // throws in hmacNik and the rebuilt bookings use case throws in
    // computePrice / qrPayload. Pre-existing latent bug (same spread shape
    // in the old deps.js); fixed here, before the local real test.
    nikHmacKey: config.nikHmacKey,
    qrKey: config.qrHmacKey,
    fees: config.fees,
    admissionTtlMs: config.admissionTtlMs,
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
  const rebuildWorkers = () =>
    Object.assign(
      deps,
      buildWorkers({ bookingService: deps.useCases.bookings, queueFeed: deps.useCases.queueFeed, config })
    );
  if (config.databaseUrl && !overrides.store) {
    deps.store = await PgStore.connect(config.databaseUrl);
    deps.useCases = buildUseCases({ ...deps, store: deps.store });
    rebuildWorkers();
  }
  if (config.valkeyUrl && !overrides.stock) {
    deps.stock = await RedisStock.connect(config.valkeyUrl);
    if (!overrides.feed) deps.feed = new RedisQueueFeed(deps.stock.client);
    deps.useCases = buildUseCases({ ...deps, stock: deps.stock });
    deps.auth = buildAuth({
      publicKeys: deps.publicKeys,
      isDenied: (jti) => deps.stock.isDenied(jti),
      stock: deps.stock,
      serviceKey: config.serviceKey
    });
    rebuildWorkers();
  }
  if (config.sqsNotificationQueueUrl && !overrides.eventBus) {
    deps.eventBus = await SqsEventBus.create({
      region: config.awsRegion,
      notificationQueueUrl: config.sqsNotificationQueueUrl
    });
    deps.useCases = buildUseCases({ ...deps, eventBus: deps.eventBus });
    rebuildWorkers();
  }
  return deps;
}

module.exports = { createDeps, createDefaultDeps };
