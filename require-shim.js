/**
 * This is necessary because we have transitive dependencies on CommonJS modules
 * that use require() conditionally:
 *
 * https://github.com/tapjs/signal-exit/blob/v3.0.7/index.js#L26-L27
 *
 * This is not compatible with ESM, so we need to shim require() to use the
 * CommonJS module loader.
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.require = createRequire(import.meta.url);
globalThis.__filename = fileURLToPath(import.meta.url);
globalThis.__dirname = dirname(globalThis.__filename);
