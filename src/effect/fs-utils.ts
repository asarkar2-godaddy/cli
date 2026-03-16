/**
 * Shared filesystem utilities built on @effect/platform FileSystem.
 */

import { FileSystem } from "@effect/platform/FileSystem";
import * as Effect from "effect/Effect";

/**
 * Check if a file exists, returning false on any error (permission denied, etc.).
 * Eliminates the repeated `fs.exists(path).pipe(Effect.orElseSucceed(() => false))` pattern.
 */
export function fileExists(
  path: string,
): Effect.Effect<boolean, never, FileSystem> {
  return Effect.flatMap(FileSystem, (fs) =>
    fs.exists(path).pipe(Effect.orElseSucceed(() => false)),
  );
}
