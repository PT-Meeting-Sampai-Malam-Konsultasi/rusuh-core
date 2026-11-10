const fs = require('fs');
const path = require('path');

/**
 * Email templates (rusuh-web#46 / FR-22-C1). The four designed e-mails
 * (otp, ticket, expired, refund) live as bundled read-only assets in
 * src/domain/templates — {name}.{locale}.{txt,html} — loaded once at module
 * start. Reading bundled immutable assets at startup is not infrastructure
 * I/O; this module stays a pure renderer. The OTP code is rendered into the
 * body but NEVER logged.
 */

const TEMPLATE_NAMES = {
  EMAIL_OTP: 'otp',
  EMAIL_TICKET: 'ticket',
  EMAIL_EXPIRED: 'expired',
  EMAIL_REFUND_FLAGGED: 'refund'
};

const LOCALES = ['id', 'en'];

function loadTemplates() {
  const templates = {};
  Object.values(TEMPLATE_NAMES).forEach((name) => {
    templates[name] = {};
    LOCALES.forEach((locale) => {
      const base = path.join(__dirname, 'templates', `${name}.${locale}`);
      templates[name][locale] = {
        text: fs.readFileSync(`${base}.txt`, 'utf8'),
        html: fs.readFileSync(`${base}.html`, 'utf8')
      };
    });
  });
  return templates;
}

const TEMPLATES = loadTemplates();

/**
 * Escapes a value for safe insertion into HTML text and attribute context.
 *
 * @param {string} value - Raw value.
 * @returns {string} HTML-escaped value.
 */
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Renders one Mustache-lite string: {{var}} substitution plus
 * {{#section}}...{{/section}} loops. No triple-mustache, no inverted
 * sections. Missing variables render as ''. Values are escaped only when
 * rendering HTML (escape: true).
 *
 * @param {string} template - Template source.
 * @param {object} scope - Variables in scope.
 * @param {object} options - { escape: boolean }.
 * @returns {string} Rendered string.
 */
function renderMustache(template, scope, { escape }) {
  const substitute = (value) => {
    const raw = value === undefined || value === null ? '' : String(value);
    return escape ? escapeHtml(raw) : raw;
  };
  let out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, key, body) => {
    const value = scope[key];
    if (!Array.isArray(value)) return '';
    return value.map((item) => renderMustache(body, { ...scope, ...item }, { escape })).join('');
  });
  out = out.replace(/\{\{(\w+)\}\}/g, (_match, key) => substitute(scope[key]));
  return out;
}

/**
 * Renders an email for a validated job.
 *
 * @param {object} job - Validated job ({type, locale, variables, ...}).
 * @param {object} [extra] - Extra variables merged into the template scope
 *   (e.g. S3 download links resolved by the use case).
 * @returns {object} {subject, text, html}.
 * @throws {Error} When the job type has no template.
 */
function renderEmail(job, extra = {}) {
  const name = TEMPLATE_NAMES[job.type];
  if (!name) throw new Error(`No template for type ${job.type}`);
  const locale = LOCALES.includes(job.locale) ? job.locale : 'id';
  const template = TEMPLATES[name][locale];
  const scope = { ...job.variables, ...extra };
  const subjectMatch = template.text.match(/^Subject: (.*)$/m);
  const subject = subjectMatch ? renderMustache(subjectMatch[1], scope, { escape: false }) : '';
  return {
    subject,
    text: renderMustache(template.text.replace(/^Subject: .*\n+/, ''), scope, { escape: false }),
    html: renderMustache(template.html, scope, { escape: true })
  };
}

module.exports = { renderEmail };
