/**
 * Extension bundler service.
 * Orchestrates esbuild bundling with temp directory management and error handling.
 */

import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	type ExtensionType,
	buildEsbuildOptions,
} from "@core/extension/bundler-config";
import {
	buildArtifactName,
	computeHash,
	formatTimestamp,
	shortHash,
} from "@core/extension/naming";
import * as Effect from "effect/Effect";
import * as esbuild from "esbuild";
import { ConfigurationError } from "../../effect/errors";
import { FileSystem, type FileSystemService } from "../../effect/services/filesystem";
import { getLogger } from "../logger";

/**
 * Result of a successful bundle operation.
 */
export interface BundleResult {
	packageName: string;
	version?: string;
	artifactPath: string;
	artifactName: string;
	size: number;
	sha256: string;
	sourcemapPath?: string;
}

/**
 * Options for bundling an extension.
 */
export interface BundleOptions {
	repoRoot: string;
	timestamp?: string;
	extensionDir?: string;
	extensionType?: ExtensionType;
}

/**
 * Package metadata for bundling.
 */
export interface ExtensionPackage {
	name: string;
	version?: string;
}

/**
 * Resolves TypeScript configuration file path.
 * Checks extension directory first, then repo root, then returns undefined.
 *
 * @param extensionDir - Directory containing the extension
 * @param repoRoot - Repository root directory
 * @returns Path to tsconfig.json or undefined
 */
export function resolveTsConfig(
	extensionDir: string,
	repoRoot: string,
	fs: FileSystemService,
): string | undefined {
	const localTsConfig = join(extensionDir, "tsconfig.json");
	if (fs.existsSync(localTsConfig)) {
		return localTsConfig;
	}

	const rootTsConfig = join(repoRoot, "tsconfig.json");
	if (fs.existsSync(rootTsConfig)) {
		return rootTsConfig;
	}

	return undefined;
}

/**
 * Creates temporary directory for bundling artifacts.
 * Structure: ${os.tmpdir()}/gd-cli/${repoName}/deploy-${timestamp}/
 *
 * @param repoRoot - Repository root path
 * @param timestamp - Timestamp for deploy session
 * @returns Path to temp directory
 */
export function createTempDirectory(
	repoRoot: string,
	timestamp: string,
): string {
	const repoName = basename(repoRoot);
	return join(tmpdir(), "gd-cli", repoName, `deploy-${timestamp}`);
}

/**
 * Cleans up temporary directory and all contents.
 *
 * @param tempDir - Directory to remove
 */
export function cleanupTempDirectoryEffect(
	tempDir: string,
): Effect.Effect<void, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		try {
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		} catch (error) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: `Failed to cleanup temp directory: ${error instanceof Error ? error.message : String(error)}`,
					userMessage: "Failed to cleanup temporary build files",
				}),
			);
		}
	});
}

/**
 * Bundles an extension from its directory (convenience wrapper).
 * Resolves entry point and delegates to bundleExtensionEffect.
 *
 * This is the recommended entry point for bundling - it matches the
 * scanExtension pattern used in security scanning.
 *
 * @param extensionDir - Absolute path to extension directory
 * @param options - Bundle options
 * @returns Effect with BundleResult
 */
export function bundleExtensionFromDirEffect(
	extensionDir: string,
	options: BundleOptions,
): Effect.Effect<BundleResult, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const { readPackageJsonWithFs } = yield* Effect.promise(
			() => import("./workspace"),
		);
		const { resolveEntryPoint } = yield* Effect.promise(
			() => import("../../core/extension/entry"),
		);

		// Read package.json
		const packageJsonPath = join(extensionDir, "package.json");
		let packageJson: Record<string, unknown>;
		try {
			packageJson = readPackageJsonWithFs(packageJsonPath, fs);
		} catch (error) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: `Failed to read package.json: ${error instanceof Error ? error.message : String(error)}`,
					userMessage: "Failed to read extension package.json",
				}),
			);
		}

		const name = packageJson.name as string;
		const version = packageJson.version as string | undefined;

		// Resolve entry point
		let entryResolution: Awaited<ReturnType<typeof resolveEntryPoint>>;
		try {
			entryResolution = resolveEntryPoint(
				{ packageDir: extensionDir, packageJson },
				fs,
			);
		} catch (error) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: `Failed to resolve entry point: ${error instanceof Error ? error.message : String(error)}`,
					userMessage: "Failed to resolve extension entry point",
				}),
			);
		}

		const { entryPath } = entryResolution;

		// Bundle the extension
		return yield* bundleExtensionEffect({ name, version }, entryPath, {
			...options,
			extensionDir,
		});
	});
}

/**
 * Bundles an extension into an ESM artifact with sourcemap.
 *
 * Process:
 * 1. Create temp directory per extension
 * 2. Resolve tsconfig (local -> root -> undefined)
 * 3. Run esbuild with write: false
 * 4. Extract .mjs and .mjs.map from outputFiles
 * 5. Compute hash of bundle content
 * 6. Build artifact filename with sanitization
 * 7. Update sourceMappingURL to match renamed map file
 * 8. Write both files to temp directory
 * 9. Return BundleResult with metadata
 *
 * @param pkg - Package metadata (name, version)
 * @param entryPath - Absolute path to entry point
 * @param options - Bundle options
 * @returns Effect with BundleResult
 */
export function bundleExtensionEffect(
	pkg: ExtensionPackage,
	entryPath: string,
	options: BundleOptions,
): Effect.Effect<BundleResult, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const logger = getLogger();
		const startTime = Date.now();
		const timestamp = options.timestamp || formatTimestamp();

		// Create temp directory structure
		const tempRoot = createTempDirectory(options.repoRoot, timestamp);
		const extensionTempDir = join(tempRoot, pkg.name);

		fs.mkdirSync(extensionTempDir, { recursive: true });

		// Resolve tsconfig
		const extensionDir = options.extensionDir ?? join(entryPath, "..");
		const tsconfigPath = resolveTsConfig(extensionDir, options.repoRoot, fs);

		// Build esbuild config
		const config = buildEsbuildOptions({
			entryPath,
			tsconfigPath,
			extensionType: options.extensionType,
			extensionDir,
		});

		// Run esbuild
		const buildResult = yield* Effect.tryPromise({
			try: () => esbuild.build(config),
			catch: (error) =>
				new ConfigurationError({
					message: `ESBUILD_ERROR: ${error instanceof Error ? error.message : String(error)}`,
					userMessage: "Failed to bundle extension",
				}),
		});

		// Extract output files
		const outputFiles = buildResult.outputFiles;
		if (!outputFiles || outputFiles.length === 0) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: "No output files generated by esbuild",
					userMessage: "Failed to bundle extension",
				}),
			);
		}

		const mjsFile = outputFiles.find((f) => f.path.endsWith(".mjs"));
		const mapFile = outputFiles.find((f) => f.path.endsWith(".mjs.map"));

		if (!mjsFile) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: "No .mjs file generated by esbuild",
					userMessage: "Failed to bundle extension",
				}),
			);
		}

		// Prepare bundle content (will be modified for sourcemap URL)
		let bundleContent = mjsFile.text;

		// First pass: strip any existing sourceMappingURL for consistent hashing
		// Also strip trailing newlines for consistency
		const bundleWithoutSourceMap = bundleContent
			.replace(/^\/\/# sourceMappingURL=.*$/m, "")
			.trimEnd();

		// Compute hash on content WITHOUT sourceMappingURL to avoid circularity
		const sha256 = computeHash(Buffer.from(bundleWithoutSourceMap));
		const hash = shortHash(sha256);

		// Build artifact name using the hash
		const artifactName = buildArtifactName(
			pkg.name,
			pkg.version || "0.0.0",
			timestamp,
			hash,
		);

		// Update sourceMappingURL in bundle to match renamed map file
		bundleContent = bundleWithoutSourceMap;
		if (mapFile) {
			const mapName = `${artifactName}.map`;
			bundleContent += `\n//# sourceMappingURL=${mapName}\n`;
		}

		// Write bundle file
		const artifactPath = join(extensionTempDir, artifactName);
		fs.writeFileSync(artifactPath, bundleContent);

		// Write sourcemap file if present
		let sourcemapPath: string | undefined;
		if (mapFile) {
			sourcemapPath = `${artifactPath}.map`;
			fs.writeFileSync(sourcemapPath, mapFile.text);
		}

		const durationMs = Date.now() - startTime;
		const size = Buffer.byteLength(bundleContent);

		// Emit debug log
		logger.debug({
			type: "bundle",
			extension: pkg.name,
			entry: entryPath,
			size,
			sha256,
			durationMs,
		});

		return {
			packageName: pkg.name,
			version: pkg.version,
			artifactPath,
			artifactName,
			size,
			sha256,
			sourcemapPath,
		};
	});
}
