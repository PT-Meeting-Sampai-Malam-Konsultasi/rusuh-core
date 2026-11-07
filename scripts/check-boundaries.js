#!/usr/bin/env node
/**
 * Enforces the Onion / Clean Architecture dependency rule for one app.
 *
 * Usage: node scripts/check-boundaries.js apps/<name> [apps/<name> ...]
 * Exit 0 = no violation, exit 1 = violation(s) listed.
 *
 * Layers (src/ of one app) and what each may import:
 *   domain/         — pure business logic. ONLY: node built-ins,
 *                     @rusuh/contracts, other domain/ files.
 *   application/    — use cases. ONLY: domain/, @rusuh/contracts,
 *                     node built-ins, npm packages.
 *   infrastructure/ — adapters. ONLY: domain/, application/ (ports),
 *                     @rusuh/contracts, @rusuh/auth, @rusuh/observability,
 *                     node built-ins, npm packages. NEVER presentation/.
 *   presentation/   — HTTP. ONLY: application/, domain/ (DTOs),
 *                     @rusuh/contracts, @rusuh/auth, @rusuh/observability,
 *                     node built-ins, npm packages. NEVER infrastructure/.
 *   platform/       — cross-cutting shims. ONLY: node built-ins,
 *                     @rusuh/contracts.
 *   src/*.js (app.js, server.js, alias.js, container.js) — composition
 *                     root / entry points: exempt, they wire everything.
 *                     The container (was deps.js / dependencies.js) lives
 *                     here, NOT in infrastructure/, because it imports
 *                     from every layer to wire them together.
 *
 * Test files (*.test.js, __tests__/) are exempt — a test may import the
 * whole app to verify the wiring.
 *
 * The `@/` alias resolves to src/. Relative requires are resolved against
 * the requiring file. Anything that is not a relative path, `@/`, or a
 * workspace package is an npm package or a node built-in.
 */
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const NODE_BUILTINS = new Set(builtinModules);

const LAYERS = ['domain', 'application', 'infrastructure', 'presentation', 'platform'];

// What a file in `layer` may import (by the imported file's top-level
// folder, or by package name). Each layer may always import itself.
const ALLOWED = {
  domain: new Set(['domain', '@rusuh/contracts']),
  application: new Set(['application', 'domain', '@rusuh/contracts', 'npm']),
  infrastructure: new Set([
    'infrastructure',
    'domain',
    'application',
    '@rusuh/contracts',
    '@rusuh/auth',
    '@rusuh/observability',
    'npm'
  ]),
  presentation: new Set([
    'presentation',
    'application',
    'domain',
    '@rusuh/contracts',
    '@rusuh/auth',
    '@rusuh/observability',
    'npm'
  ]),
  platform: new Set(['platform', '@rusuh/contracts'])
};

function topLayer(srcDir, absPath) {
  const rel = path.relative(srcDir, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // outside src
  const first = rel.split(path.sep)[0];
  return LAYERS.includes(first) ? first : 'root';
}

function classifyImport(srcDir, fromFile, spec) {
  // Returns { kind, target } where kind is 'layer' | 'package' | 'builtin'
  // and target is the layer name or package name.
  if (NODE_BUILTINS.has(spec) || spec.startsWith('node:')) {
    return { kind: 'builtin', target: spec };
  }
  if (spec.startsWith('@/')) {
    const abs = path.join(srcDir, spec.slice(2));
    return { kind: 'layer', target: topLayer(srcDir, abs) || 'root' };
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const abs = path.resolve(path.dirname(fromFile), spec);
    return { kind: 'layer', target: topLayer(srcDir, abs) || 'root' };
  }
  // Workspace packages and npm packages.
  if (spec.startsWith('@rusuh/')) {
    return { kind: 'package', target: spec.split('/').slice(0, 2).join('/') };
  }
  return { kind: 'package', target: 'npm' };
}

function collectJsFiles(dir, out) {
  const acc = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'coverage') {
        collectJsFiles(full, acc);
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      acc.push(full);
    }
  });
  return acc;
}

const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function checkApp(appDir) {
  const srcDir = path.join(appDir, 'src');
  if (!fs.existsSync(srcDir)) {
    console.error(`skip: no src/ in ${appDir}`);
    return [];
  }
  const violations = [];
  collectJsFiles(srcDir).forEach((file) => {
    const relFile = path.relative(appDir, file);
    if (relFile.includes('__tests__') || file.endsWith('.test.js')) return; // tests exempt
    const layer = topLayer(srcDir, file);
    if (layer === 'root' || !layer) return; // app.js / server.js / alias.js / container.js: composition root
    const content = fs.readFileSync(file, 'utf8');
    let m = REQUIRE_RE.exec(content);
    while (m !== null) {
      const spec = m[1];
      const { kind, target } = classifyImport(srcDir, file, spec);
      if (kind !== 'builtin' && !ALLOWED[layer].has(target)) {
        violations.push(`${relFile} [${layer}] -> ${spec} (${target})`);
      }
      m = REQUIRE_RE.exec(content);
    }
  });
  return violations;
}

function main() {
  const apps = process.argv.slice(2);
  if (apps.length === 0) {
    console.error('usage: node scripts/check-boundaries.js apps/<name> [...]');
    process.exit(2);
  }
  let all = [];
  apps.forEach((app) => {
    const v = checkApp(app);
    if (v.length > 0) {
      console.log(`\n${app}: ${v.length} boundary violation(s)`);
      v.forEach((line) => console.log(`  ${line}`));
    } else {
      console.log(`${app}: OK (no boundary violation)`);
    }
    all = all.concat(v);
  });
  if (all.length > 0) {
    console.error(`\n${all.length} boundary violation(s) total.`);
    process.exit(1);
  }
}

main();
