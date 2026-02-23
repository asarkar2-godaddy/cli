/**
 * Shared test helper: provides the real node:fs for tests.
 * Since the codebase now uses @effect/platform FileSystem (effectful) or
 * node:fs directly, this helper just re-exports node:fs.
 */
import * as fs from "node:fs";

export const nodeFs = fs;
