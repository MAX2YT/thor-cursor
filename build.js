#!/usr/bin/env node
/**
 * Zero-dependency bundler for thor-cursor.
 *
 * The source is a handful of ES modules with a known, acyclic import graph, so
 * a full bundler would be overkill here. This resolves the graph, strips the
 * import/export syntax, concatenates in dependency order, and wraps the result
 * in a UMD shim. It also emits a minified variant.
 *
 * Usage: node build.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
const ENTRY = 'index.js';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

/* ------------------------------------------------------------ module graph */

const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
// `export { x } from './y.js'` / `export * from './y.js'` are dependencies
// too — index.js is written entirely in re-exports.
const REEXPORT_RE = /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;

function localDeps(code) {
  const out = [];
  for (const re of [IMPORT_RE, REEXPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) {
      if (m[1].startsWith('.') && !out.includes(path.basename(m[1]))) {
        out.push(path.basename(m[1]));
      }
    }
  }
  return out;
}

const cache = new Map();
function read(file) {
  if (!cache.has(file)) {
    cache.set(file, fs.readFileSync(path.join(SRC, file), 'utf8'));
  }
  return cache.get(file);
}

/** Depth-first topological sort of the import graph. */
function order(entry) {
  const seen = new Set();
  const out = [];
  (function visit(file, stack) {
    if (seen.has(file)) return;
    if (stack.includes(file)) {
      throw new Error(`Circular import: ${stack.join(' -> ')} -> ${file}`);
    }
    for (const dep of localDeps(read(file))) {
      visit(dep, stack.concat(file));
    }
    seen.add(file);
    out.push(file);
  })(entry, []);
  return out;
}

/**
 * Strip module syntax. Because every module is concatenated into one scope,
 * imports simply disappear and exported bindings become plain declarations.
 */
function stripModuleSyntax(code) {
  return code
    // import ... from '...';
    .replace(IMPORT_RE, '')
    // bare `import '...'`
    .replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    // `export { ... } from '...'` and `export { ... }` — re-exports are
    // handled by the UMD footer, so drop the statements entirely.
    .replace(/^\s*export\s*\{[\s\S]*?\}\s*(?:from\s*['"][^'"]+['"]\s*)?;?\s*$/gm, '')
    // `export default X;`
    .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
    // `export const/let/class/function` -> drop the keyword
    .replace(/^\s*export\s+(const|let|var|class|function|async)\b/gm, '$1');
}

function banner() {
  return `/*!
 * thor-cursor v${pkg.version}
 * ${pkg.description}
 * ${pkg.homepage || ''}
 * @license ${pkg.license}
 *
 * An original Mjolnir-inspired design. Not affiliated with, endorsed by, or
 * derived from any Marvel or Disney property.
 */`;
}

function bundle() {
  const files = order(ENTRY);
  const body = files
    .filter((f) => f !== ENTRY)   // entry only re-exports
    .map((f) => `/* ---- src/${f} ---- */\n${stripModuleSyntax(read(f)).trim()}`)
    .join('\n\n');

  return `${banner()}
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    var api = factory();
    root.ThorCursor = api.ThorCursor;
    root.ThorCursorInstance = api.ThorCursorInstance;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

${body.replace(/^/gm, '  ')}

  ThorCursor.ThorCursor = ThorCursor;
  ThorCursor.ThorCursorInstance = ThorCursorInstance;
  ThorCursor.DEFAULTS = DEFAULTS;
  ThorCursor.resolveConfig = resolveConfig;
  ThorCursor.default = ThorCursor;
  return ThorCursor;
});
`;
}

/* ---------------------------------------------------------------- minifier */

/**
 * Conservative minifier: strips comments and collapses indentation/blank
 * lines. It deliberately does not rename identifiers or join statements —
 * that class of transform needs a real parser to be safe, and gzip recovers
 * most of the difference anyway.
 */
function minify(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  // Character-level scan so quotes, template literals and regex-looking
  // slashes inside strings are never mistaken for comment starts.
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];

    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        if (code[i] === '\\') { out += code[i] + (code[i + 1] || ''); i += 2; continue; }
        out += code[i];
        if (code[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }

  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length)
    .join('\n');
}

/* -------------------------------------------------------------------- main */

fs.mkdirSync(DIST, { recursive: true });

const code = bundle();
fs.writeFileSync(path.join(DIST, 'thor-cursor.js'), code);

const min = banner() + '\n' + minify(code);
fs.writeFileSync(path.join(DIST, 'thor-cursor.min.js'), min);

// An ESM build for bundler consumers that want a single file.
const esmBody = order(ENTRY)
  .filter((f) => f !== ENTRY)
  .map((f) => `/* ---- src/${f} ---- */\n${stripModuleSyntax(read(f)).trim()}`)
  .join('\n\n');
fs.writeFileSync(
  path.join(DIST, 'thor-cursor.esm.js'),
  `${banner()}\n${esmBody}\n\nexport { ThorCursor, ThorCursorInstance, DEFAULTS, resolveConfig };\nexport default ThorCursor;\n`,
);

// Ship the hand-written type definitions with the bundles.
fs.copyFileSync(path.join(SRC, 'index.d.ts'), path.join(DIST, 'thor-cursor.d.ts'));

const kb = (p) => (fs.statSync(path.join(DIST, p)).size / 1024).toFixed(1);
console.log(`thor-cursor v${pkg.version} built`);
console.log(`  dist/thor-cursor.js       ${kb('thor-cursor.js')} kB`);
console.log(`  dist/thor-cursor.min.js   ${kb('thor-cursor.min.js')} kB`);
console.log(`  dist/thor-cursor.esm.js   ${kb('thor-cursor.esm.js')} kB`);
console.log(`  dist/thor-cursor.d.ts     ${kb('thor-cursor.d.ts')} kB`);
