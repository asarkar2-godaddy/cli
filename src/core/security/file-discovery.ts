import { join, resolve } from "node:path";
import { FileSystem } from "@effect/platform/FileSystem";
import * as Effect from "effect/Effect";
import { ConfigurationError } from "../../effect/errors";
import { getSecurityConfig, shouldExcludeFile } from "./config";

/**
 * Supported source file extensions for security scanning
 */
const SOURCE_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"];

/**
 * Recursively discover all source files to scan in an extension directory.
 * Applies security configuration exclusion patterns (node_modules, dist, build, __tests__).
 */
export function findFilesToScan(
  rootPath: string,
): Effect.Effect<string[], ConfigurationError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const config = getSecurityConfig();
    const absoluteRoot = resolve(rootPath);

    // Verify root directory exists
    const rootInfo = yield* fs.stat(absoluteRoot).pipe(
      Effect.mapError(
        (error) =>
          new ConfigurationError({
            message: error.message,
            userMessage: `Failed to access directory: ${absoluteRoot}`,
          }),
      ),
    );

    if (rootInfo.type !== "Directory") {
      return yield* Effect.fail(
        new ConfigurationError({
          message: `Path is not a directory: ${absoluteRoot}`,
          userMessage: `Path is not a directory: ${absoluteRoot}`,
        }),
      );
    }

    const files: string[] = [];
    yield* traverseDirectory(fs, absoluteRoot, files, config);

    return files;
  });
}

type PlatformFs = Effect.Effect.Success<typeof FileSystem>;

/**
 * Recursively traverse a directory and collect source files.
 */
function traverseDirectory(
  fs: PlatformFs,
  dirPath: string,
  files: string[],
  config: ReturnType<typeof getSecurityConfig>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (shouldExcludeFile(dirPath, config)) {
      return;
    }

    const entries = yield* fs
      .readDirectory(dirPath)
      .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);

      if (shouldExcludeFile(fullPath, config)) {
        continue;
      }

      const info = yield* fs
        .stat(fullPath)
        .pipe(Effect.orElseSucceed(() => null));

      if (!info) continue;

      if (info.type === "Directory") {
        yield* traverseDirectory(fs, fullPath, files, config);
      } else if (info.type === "File" && isSourceFile(fullPath)) {
        files.push(fullPath);
      }
    }
  });
}

/**
 * Check if a file path has a supported source file extension.
 */
function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}
