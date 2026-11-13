const cors = require('cors');

/** Allowlist used when CORS_ORIGINS is unset or yields no usable entry. */
const DEFAULT_CORS_ORIGINS = Object.freeze([
  'https://rusuh-tiket.web.id',
  'https://www.rusuh-tiket.web.id',
  'https://staging.rusuh-tiket.web.id',
  'https://*.rusuh-web-staging.pages.dev',
  'http://localhost:3000',
  'http://localhost:5173'
]);

/**
 * Parses a comma-separated CORS_ORIGINS value into an origin list.
 *
 * @param {string|null} [value] - Raw comma-separated origins.
 * @returns {string[]} Trimmed, non-empty origins; a fresh copy of
 * DEFAULT_CORS_ORIGINS when nothing usable remains.
 */
function parseCorsOrigins(value) {
  const parsed = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_CORS_ORIGINS];
}

const WILDCARD_ENTRY = /^([a-z][a-z0-9+.-]*):\/\/\*\.(.+)$/i;
const SINGLE_LABEL = /^[a-z0-9-]+$/i;

/**
 * Compiles one allowlist entry into a predicate over the Origin header.
 * Plain entries match exactly. `<scheme>://*.<host>[:port]` matches exactly one
 * non-empty [A-Za-z0-9-] label in front of <host>, same scheme and port.
 * Hosts are compared as parsed parts, never through a RegExp built from config.
 * Malformed entries (any other `*`, bad host) compile to a predicate that never matches.
 *
 * @param {string} entry - One CORS_ORIGINS entry.
 * @returns {(origin: string) => boolean} Predicate.
 */
function compileEntry(entry) {
  const wildcard = WILDCARD_ENTRY.exec(entry);
  if (!wildcard) {
    return entry.includes('*') ? () => false : (origin) => origin === entry;
  }
  let base;
  try {
    base = new URL(`${wildcard[1]}://${wildcard[2]}`);
  } catch {
    return () => false;
  }
  const wellFormed =
    base.hostname !== '' &&
    !wildcard[2].includes('*') &&
    base.pathname === '/' &&
    !base.search &&
    !base.hash &&
    !base.username;
  if (!wellFormed || wildcard[2].replace(/:\d*$/, '') !== base.hostname) return () => false;
  const hostSuffix = `.${base.hostname}`;
  return (origin) => {
    let candidate;
    try {
      candidate = new URL(origin);
    } catch {
      return false;
    }
    if (candidate.origin !== origin || candidate.protocol !== base.protocol || candidate.port !== base.port)
      return false;
    const { hostname } = candidate;
    return hostname.endsWith(hostSuffix) && SINGLE_LABEL.test(hostname.slice(0, -hostSuffix.length));
  };
}

/**
 * Builds a function deciding whether an Origin header is allowed.
 *
 * @param {string[]} origins - Allowlist entries (exact or single-label wildcard).
 * @returns {(origin: string|undefined) => boolean} True when the origin matches an entry.
 */
function createOriginMatcher(origins) {
  const matchers = origins.map(compileEntry);
  return (origin) => typeof origin === 'string' && origin !== '' && matchers.some((match) => match(origin));
}

/**
 * Builds the CORS middleware shared by every service: origin allowlist, with
 * credentials enabled so the web app can send and receive the refresh cookie
 * (fetch credentials: 'include'). Safe because the origin is matched against
 * the allowlist and never reflected for an unlisted origin or answered with '*'.
 *
 * @param {string[]} origins - Allowed origins (config.corsOrigins).
 * @returns {import('express').RequestHandler} CORS middleware.
 */
function createCors(origins) {
  const isAllowed = createOriginMatcher(origins);
  return cors({
    origin: (origin, callback) => callback(null, isAllowed(origin)),
    credentials: true,
    exposedHeaders: ['X-Request-ID']
  });
}

module.exports = { DEFAULT_CORS_ORIGINS, parseCorsOrigins, createOriginMatcher, createCors };
