const { verifyAccountToken } = require('@rusuh/auth');
const { problemError } = require('@/domain/problem');

/**
 * Account authentication (Q43): verifies the Bearer account JWT locally
 * (Ed25519, no hot-path call to auth-module). Attaches req.account.
 * The verifier is injectable (tests pass a stub); production wires the
 * shared @rusuh/auth verifyAccountToken with the JWKS public keys.
 *
 * @param {object} deps
 * @param {Function} [deps.verify] - (token) => Promise<payload>.
 * @param {Map} [deps.publicKeys] - kid -> JWK (used by the default verifier).
 * @param {Function} [deps.isDenied] - Async (jti) => boolean (denylist).
 * @param {string} [deps.expectedAud] - Expected audience (config AUTH_AUDIENCE).
 * @param {string} [deps.expectedIss] - Expected issuer (config AUTH_ISSUER).
 * @returns {Function} Express middleware.
 */
function createRequireAccount({ verify, publicKeys, isDenied, expectedAud, expectedIss } = {}) {
  const verifyFn =
    verify ||
    ((token) =>
      verifyAccountToken(token, {
        publicKeys,
        isDenied: isDenied || (async () => false),
        expectedAud,
        expectedIss
      }));
  return async (request, _response, next) => {
    try {
      const header = request.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
      if (!token) throw problemError('UNAUTHORIZED', 'The token is missing, expired or has a bad signature.');
      const payload = await verifyFn(token);
      request.account = { sub: payload.sub, jti: payload.jti, exp: payload.exp, iat: payload.iat };
      next();
    } catch (error) {
      if (error && error.code === 'UNAUTHORIZED') {
        next(problemError('UNAUTHORIZED', 'The token is missing, expired or has a bad signature.'));
      } else {
        next(error);
      }
    }
  };
}

/**
 * Admission validation (ADR-0021): validates the X-Admission-Token against
 * the Valkey entry (exists + belongs to this account + event matches).
 * The entry is registered synchronously (POST /v1/core/admission,
 * ADR-0027) before the user receives the token, so it is present by the
 * time the user opens Detail; the lookup is still retried briefly (~3 s,
 * ~200 ms interval) as a defensive measure against transient Valkey lag
 * before 403 ADMISSION_INVALID.
 * Attaches req.admission = { token, userId, eventId, slotId, deviceId, maxTickets, expiresAt }.
 *
 * @param {object} deps
 * @param {object} deps.stock - Stock adapter (getAdmission).
 * @param {number} [deps.retryMs] - Total retry window (default 3000).
 * @param {number} [deps.retryIntervalMs] - Retry interval (default 200).
 * @returns {Function} Express middleware.
 */
function createRequireAdmission({ stock, retryMs = 3000, retryIntervalMs = 200 } = {}) {
  if (!stock) throw new Error('createRequireAdmission requires stock');
  return async (request, _response, next) => {
    try {
      const token = request.headers['x-admission-token'];
      if (!token || typeof token !== 'string') {
        throw problemError(
          'ADMISSION_INVALID',
          'The admission token is missing, expired or no longer matches a live slot.'
        );
      }
      // The entry is registered synchronously before the user receives the
      // token (ADR-0027), so it is present by the time the user opens
      // Detail; the lookup is still retried briefly (~3 s, ~200 ms
      // interval) as a defensive measure against transient Valkey lag.
      // Recursion (not a loop) keeps the retry sequential without await-in-loop.
      const retryCount = Math.max(Math.ceil(retryMs / retryIntervalMs), 1);
      const lookupWithRetry = async (attemptsLeft) => {
        const found = await stock.getAdmission(token);
        if (found || attemptsLeft <= 0) return found;
        await new Promise((resolve) => {
          setTimeout(resolve, retryIntervalMs);
        });
        return lookupWithRetry(attemptsLeft - 1);
      };
      const entry = await lookupWithRetry(retryCount);
      if (!entry) {
        throw problemError(
          'ADMISSION_INVALID',
          'The admission token is missing, expired or no longer matches a live slot.'
        );
      }
      // The admission must belong to the logged-in account (claim binds it, ADR-0025).
      if (request.account && entry.user_id !== request.account.sub) {
        throw problemError(
          'ADMISSION_INVALID',
          'The admission token is missing, expired or no longer matches a live slot.'
        );
      }
      // The admission must be for the event in the path/body (when present).
      const eventId = request.params.eventId || request.body?.eventId || request.params.event_id;
      if (eventId && entry.event_id !== eventId) {
        throw problemError(
          'ADMISSION_INVALID',
          'The admission token is missing, expired or no longer matches a live slot.'
        );
      }
      request.admission = {
        token,
        userId: entry.user_id,
        eventId: entry.event_id,
        slotId: entry.slot_id || null,
        deviceId: entry.device_id || null,
        maxTickets: entry.max_tickets || 3,
        expiresAt: entry.expires_at
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Ownership check for a booking: the caller must hold the admission token
 * the booking was created with, or be the account owner.
 *
 * @param {object} booking - Booking row.
 * @param {object} request - Express request (req.account / req.admission).
 * @returns {boolean} Whether the caller may access the booking.
 */
function mayAccessBooking(booking, request) {
  if (request.admission && request.admission.token === booking.admissionToken) return true;
  if (request.account && request.account.sub === booking.accountId) return true;
  return false;
}

/**
 * Either-or auth for booking access (LLD-02 §4): the caller may present
 * the admission token (X-Admission-Token) OR the account JWT (Bearer).
 * At least one must verify. Attaches req.account and/or req.admission.
 *
 * @param {object} deps - Same deps as createRequireAccount + createRequireAdmission.
 * @returns {Function} Express middleware.
 */
function createRequireAccountOrAdmission(deps) {
  const requireAccount = createRequireAccount(deps);
  const requireAdmission = createRequireAdmission(deps);
  return (request, _response, next) => {
    const hasBearer = Boolean(request.headers.authorization);
    const hasAdmission = Boolean(request.headers['x-admission-token']);
    if (!hasBearer && !hasAdmission) {
      next(problemError('UNAUTHORIZED', 'The token is missing, expired or has a bad signature.'));
      return;
    }
    // Try the account first (when present), then the admission.
    const tryAdmission = () => {
      if (!hasAdmission) {
        next(problemError('UNAUTHORIZED', 'The token is missing, expired or has a bad signature.'));
        return;
      }
      requireAdmission(request, _response, (admissionError) => {
        if (admissionError) next(admissionError);
        else next();
      });
    };
    if (!hasBearer) {
      tryAdmission();
      return;
    }
    requireAccount(request, _response, (accountError) => {
      if (!accountError) {
        // Account verified; admission is optional (attach it when present).
        if (!hasAdmission) {
          next();
          return;
        }
        requireAdmission(request, _response, (admissionError) => {
          // A bad admission must not revoke a good account: ignore it.
          if (admissionError) request.admission = undefined;
          next();
        });
        return;
      }
      // Account failed; fall back to the admission token.
      tryAdmission();
    });
  };
}

/**
 * Service-key auth for internal endpoints (payment-module -> core).
 * The shared key comes from config (SERVICE_KEY); when it is not set the
 * endpoint rejects everything (fail-closed).
 *
 * @param {object} deps
 * @param {string} [deps.serviceKey] - Shared service credential.
 * @returns {Function} Express middleware.
 */
function createRequireServiceKey({ serviceKey } = {}) {
  return (request, _response, next) => {
    const presented = request.headers['x-service-key'];
    if (!serviceKey || !presented || presented !== serviceKey) {
      next(problemError('UNAUTHORIZED', 'The token is missing, expired or has a bad signature.'));
      return;
    }
    next();
  };
}

module.exports = {
  createRequireAccount,
  createRequireAdmission,
  createRequireAccountOrAdmission,
  createRequireServiceKey,
  mayAccessBooking
};
