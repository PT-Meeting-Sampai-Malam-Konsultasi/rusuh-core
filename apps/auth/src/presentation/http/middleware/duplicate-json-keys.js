const Boom = require('@hapi/boom');

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COLON = 0x3a;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * Moves an index beyond JSON whitespace.
 *
 * @param {Buffer} buffer - Raw JSON request body.
 * @param {number} index - Index from which to scan.
 * @returns {number} First non-whitespace byte index.
 */
function skipWhitespace(buffer, index) {
  let position = index;
  while (position < buffer.length && WHITESPACE.has(buffer[position])) position += 1;
  return position;
}

/**
 * Detects whether a quote is escaped by an odd number of backslashes.
 *
 * @param {Buffer} buffer - Raw JSON request body.
 * @param {number} position - Position of the quote.
 * @returns {boolean} Whether the quote is escaped.
 */
function isEscaped(buffer, position) {
  let slashCount = 0;
  let cursor = position - 1;

  while (cursor >= 0 && buffer[cursor] === BACKSLASH) {
    slashCount += 1;
    cursor -= 1;
  }

  return slashCount % 2 === 1;
}

/**
 * Finds the end index for a quoted JSON string.
 *
 * @param {Buffer} buffer - Raw JSON request body.
 * @param {number} index - Position after the opening quote.
 * @returns {number} Closing quote index, or -1 for an unterminated string.
 */
function findStringEnd(buffer, index) {
  let end = buffer.indexOf(QUOTE, index);
  while (end !== -1 && isEscaped(buffer, end)) end = buffer.indexOf(QUOTE, end + 1);
  return end;
}

/**
 * Finds the first duplicate key within a JSON object scope.
 *
 * @param {Buffer|string} rawBody - Raw JSON input.
 * @returns {string|null} Duplicate key, or null when none exists.
 */
function detectDuplicateJsonKey(rawBody) {
  const buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const scopes = [];
  let position = 0;

  while (position < buffer.length) {
    const code = buffer[position];
    position += 1;

    if (code === OPEN_BRACE) {
      scopes.push(new Set());
    } else if (code === OPEN_BRACKET) {
      scopes.push(null);
    } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
      scopes.pop();
    } else if (code === QUOTE) {
      const end = findStringEnd(buffer, position);
      if (end === -1) return null;

      const next = skipWhitespace(buffer, end + 1);
      const scope = scopes[scopes.length - 1];
      if (buffer[next] === COLON && scope instanceof Set) {
        const key = buffer.toString('utf8', position, end);
        if (scope.has(key)) return key;
        scope.add(key);
      }

      position = end + 1;
    }
  }

  return null;
}

/**
 * Creates an Express raw-body verification callback for duplicate-key protection.
 *
 * @param {boolean} enabled - Whether duplicate-key validation is active.
 * @returns {Function} Express JSON parser verification callback.
 */
function createDuplicateKeyVerifier(enabled) {
  return (_request, _response, buffer) => {
    if (!enabled || buffer.length === 0) return;

    const duplicateKey = detectDuplicateJsonKey(buffer);
    if (duplicateKey) throw Boom.badRequest(`Duplicate JSON key detected: "${duplicateKey}"`);
  };
}

module.exports = { createDuplicateKeyVerifier, detectDuplicateJsonKey };
