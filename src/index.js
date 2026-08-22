/**
 * thor-cursor — public entry point.
 *
 * ESM consumers: `import { ThorCursor } from 'thor-cursor'`
 * Script-tag consumers should use the UMD bundle in `dist/`.
 */

export { ThorCursor, ThorCursorInstance } from './cursor.js';
export { DEFAULTS, resolveConfig } from './config.js';
export { default } from './cursor.js';
