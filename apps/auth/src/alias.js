const path = require('path');

/**
 * Registers the `@` -> src module alias.
 *
 * NOTE: `require('module-alias/register')` does NOT work in this monorepo:
 * npm workspaces hoist module-alias to the repo root, so register() reads
 * the ROOT package.json (which has no _moduleAliases) instead of this app's
 * package.json. Point module-alias at this app's directory explicitly.
 */
require('module-alias')(path.join(__dirname, '..'));
