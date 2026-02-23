import type { Stats } from "node:fs";
import { join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import { FileSystem } from "../../effect/services/filesystem";
import { ConfigurationError } from "../../effect/errors";
import { getSecurityConfig, shouldExcludeFile } from "./config";

/**
 * Supported source file extensions for security scanning
 */
const SOURCE_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"];

/**
 * Recursively discover all source files to scan in an extension directory.
 * Applies security configuration exclusion patterns (node_modules, dist, build, __tests__).
 *
 * @param rootPath - Absolute or relative path to extension directory
 * @returns Effect containing Result with array of absolute file paths to scan, or error
 *
 * @example
 * ```ts
 * const result = yield* findFilesToScan('/path/to/extension');
 * if (result.success && result.data) {
 *   console.log(`Found ${result.data.length} files to scan`);
 *   for (const file of result.data) {
 *     console.log(file);
 *   }
 * }
 * ```
 */
export function findFilesToScan(
	rootPath: string,
): Effect.Effect<string[], ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const config = getSecurityConfig();
		const absoluteRoot = resolve(rootPath);

		// Verify root directory exists
		let rootStats: Stats;
		try {
			rootStats = fs.statSync(absoluteRoot);
		} catch (error) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: error instanceof Error ? error.message : String(error),
					userMessage: `Failed to access directory: ${absoluteRoot}`,
				}),
			);
		}

		if (!rootStats.isDirectory()) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: `Path is not a directory: ${absoluteRoot}`,
					userMessage: `Path is not a directory: ${absoluteRoot}`,
				}),
			);
		}

		const files: string[] = [];
		traverseDirectory(fs, absoluteRoot, files, config);

		return files;
	});
}

/**
 * Recursively traverse a directory and collect source files.
 * Skips directories and files matching exclusion patterns.
 * Uses synchronous FileSystem service methods.
 *
 * @param fs - FileSystem service instance
 * @param dirPath - Absolute path to directory
 * @param files - Array to accumulate file paths (mutated)
 * @param config - Security configuration with exclusion patterns
 */
function traverseDirectory(
	fs: Effect.Effect.Success<typeof FileSystem>,
	dirPath: string,
	files: string[],
	config: ReturnType<typeof getSecurityConfig>,
): void {
	// Check if directory should be excluded
	if (shouldExcludeFile(dirPath, config)) {
		return;
	}

	let entries: string[];
	try {
		entries = fs.readdirSync(dirPath);
	} catch (_error) {
		// Skip directories we can't read (permission issues, etc.)
		return;
	}

	for (const entry of entries) {
		const fullPath = join(dirPath, entry);

		// Check exclusions before stat
		if (shouldExcludeFile(fullPath, config)) {
			continue;
		}

		let stats: Stats;
		try {
			stats = fs.statSync(fullPath);
		} catch (_error) {
			// Skip files/dirs we can't stat
			continue;
		}

		if (stats.isDirectory()) {
			// Recurse into subdirectory
			traverseDirectory(fs, fullPath, files, config);
		} else if (stats.isFile() && isSourceFile(fullPath)) {
			// Add source file to list
			files.push(fullPath);
		}
	}
}

/**
 * Check if a file path has a supported source file extension.
 *
 * @param filePath - Path to file
 * @returns True if file has .js, .ts, .jsx, .tsx, .mjs, or .cjs extension
 */
function isSourceFile(filePath: string): boolean {
	return SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}
