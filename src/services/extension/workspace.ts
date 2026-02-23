import { join } from "node:path";
import * as Effect from "effect/Effect";
import { ConfigurationError } from "../../effect/errors";
import { FileSystem, type FileSystemService } from "../../effect/services/filesystem";

/**
 * Package manager types supported by the CLI
 */
export type PackageManager = "pnpm" | "yarn" | "npm" | "unknown";

/**
 * Represents a detected extension package in the workspace
 */
export interface ExtensionPackage {
	/** Package name from package.json */
	name: string;
	/** Package version from package.json */
	version?: string;
	/** Absolute path to the extension directory */
	dir: string;
	/** Absolute path to the package.json file */
	packageJsonPath: string;
	/** Detected package manager for the workspace */
	packageManager: PackageManager;
}

/**
 * Options for detecting extensions in the workspace
 */
export interface DetectExtensionsOptions {
	/** Root directory of the repository (defaults to process.cwd()) */
	repoRoot?: string;
	/** Name of the extensions directory (defaults to "extensions") */
	extensionsDir?: string;
}

/**
 * Gets all extension packages in the workspace by scanning the extensions directory.
 *
 * This function scans the configured extensions directory (default: ./extensions) and
 * identifies all subdirectories containing a valid package.json file as extension packages.
 *
 * @param options - Configuration options for extension detection
 * @returns Effect resolving to an array of detected extension packages
 */
export function getExtensionsEffect(
	options?: DetectExtensionsOptions,
): Effect.Effect<ExtensionPackage[], ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const repoRoot = options?.repoRoot ?? process.cwd();
		const extensionsDir = options?.extensionsDir ?? "extensions";
		const extensionsPath = join(repoRoot, extensionsDir);

		// Detect package manager once for all extensions
		const packageManager = detectPackageManagerWithFs(repoRoot, fs);

		// Try extensions directory first
		if (fs.existsSync(extensionsPath)) {
			// Check if it's a directory
			const stats = fs.statSync(extensionsPath);
			if (!stats.isDirectory()) {
				return yield* Effect.fail(
					new ConfigurationError({
						message: `Extensions path ${extensionsPath} exists but is not a directory`,
						userMessage: "Failed to detect workspace extensions",
					}),
				);
			}

			// Read all subdirectories in the extensions directory
			const entries = fs.readdirSync(extensionsPath, {
				withFileTypes: true,
			});
			const extensions: ExtensionPackage[] = [];

			for (const entry of entries) {
				// Skip files, only process directories
				if (!entry.isDirectory()) {
					continue;
				}

				const extensionDir = join(extensionsPath, entry.name);
				const packageJsonPath = join(extensionDir, "package.json");

				// Check if package.json exists
				if (!fs.existsSync(packageJsonPath)) {
					continue;
				}

				// Read and parse package.json
				const packageJson = readPackageJsonWithFs(packageJsonPath, fs);

				const name = packageJson.name as string | undefined;
				const version = packageJson.version as string | undefined;

				if (!name) {
					return yield* Effect.fail(
						new ConfigurationError({
							message: `Extension in directory "${entry.name}" has invalid package.json: missing "name" field`,
							userMessage: "Failed to detect workspace extensions",
						}),
					);
				}

				extensions.push({
					name,
					version,
					dir: extensionDir,
					packageJsonPath,
					packageManager,
				});
			}

			return extensions;
		}

		// Fallback to workspaces
		const rootPackageJsonPath = join(repoRoot, "package.json");
		if (!fs.existsSync(rootPackageJsonPath)) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: `No extensions directory found at ${extensionsPath} and no package.json found at repository root`,
					userMessage: "Failed to detect workspace extensions",
				}),
			);
		}

		const rootPackageJson = readPackageJsonWithFs(rootPackageJsonPath, fs);
		const workspaces = rootPackageJson.workspaces as string[] | undefined;

		if (
			!workspaces ||
			!Array.isArray(workspaces) ||
			workspaces.length === 0
		) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: `No extensions directory found at ${extensionsPath} and no workspaces defined in package.json. Either create ${extensionsDir}/ directory or add workspaces to package.json.`,
					userMessage: "Failed to detect workspace extensions",
				}),
			);
		}

		// Process workspaces
		const extensions: ExtensionPackage[] = [];

		for (const workspace of workspaces) {
			// Resolve glob patterns (simple support for */pattern)
			const workspacePaths: string[] = [];

			if (workspace.includes("*")) {
				// Simple glob support: packages/* or apps/*
				const baseDir = workspace.replace("/*", "");
				const basePath = join(repoRoot, baseDir);

				if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
					const entries = fs.readdirSync(basePath, {
						withFileTypes: true,
					});
					for (const entry of entries) {
						if (entry.isDirectory()) {
							workspacePaths.push(join(basePath, entry.name));
						}
					}
				}
			} else {
				// Direct path
				workspacePaths.push(join(repoRoot, workspace));
			}

			// Check each workspace path
			for (const workspacePath of workspacePaths) {
				const packageJsonPath = join(workspacePath, "package.json");

				if (!fs.existsSync(packageJsonPath)) {
					continue;
				}

				let packageJson: Record<string, unknown>;
				try {
					packageJson = readPackageJsonWithFs(packageJsonPath, fs);
				} catch {
					continue; // Skip invalid package.json in workspaces
				}

				// Check if this workspace is marked as an extension
				const godaddy = packageJson.godaddy as
					| Record<string, unknown>
					| boolean
					| undefined;
				const isExtension =
					(typeof godaddy === "object" &&
						!Array.isArray(godaddy) &&
						(godaddy.extension === true || godaddy.type === "extension")) ||
					godaddy === true;

				if (!isExtension) {
					continue;
				}

				const name = packageJson.name as string | undefined;
				const version = packageJson.version as string | undefined;

				if (!name) {
					continue; // Skip packages without name
				}

				extensions.push({
					name,
					version,
					dir: workspacePath,
					packageJsonPath,
					packageManager,
				});
			}
		}

		return extensions;
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(
				error._tag === "ConfigurationError"
					? error
					: new ConfigurationError({
							message: "message" in error ? error.message : String(error),
							userMessage: "Failed to detect workspace extensions",
						}),
			),
		),
	);
}

/**
 * Detects the package manager being used in the workspace.
 * Uses the FileSystem service for all I/O.
 *
 * Detection priority:
 * 1. package.json "packageManager" field -> parse manager type
 * 2. pnpm-lock.yaml -> pnpm
 * 3. yarn.lock -> yarn
 * 4. package-lock.json -> npm
 * 5. none found -> unknown
 *
 * @param repoRoot - Root directory of the repository to check
 * @param fs - FileSystem service instance
 * @returns The detected package manager type
 */
export function detectPackageManagerWithFs(
	repoRoot: string,
	fs: FileSystemService,
): PackageManager {
	// First, check package.json's packageManager field
	const rootPackageJsonPath = join(repoRoot, "package.json");
	if (fs.existsSync(rootPackageJsonPath)) {
		try {
			const pkg = readPackageJsonWithFs(rootPackageJsonPath, fs);
			const packageManager = pkg.packageManager as string | undefined;
			if (packageManager) {
				// packageManager format is like "pnpm@8.0.0" or "yarn@3.0.0"
				if (packageManager.startsWith("pnpm")) return "pnpm";
				if (packageManager.startsWith("yarn")) return "yarn";
				if (packageManager.startsWith("npm")) return "npm";
			}
		} catch {
			// Fall through to lockfile detection
		}
	}

	// Fallback to lockfile detection
	if (fs.existsSync(join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
	if (fs.existsSync(join(repoRoot, "yarn.lock"))) return "yarn";
	if (fs.existsSync(join(repoRoot, "package-lock.json"))) return "npm";

	return "unknown";
}

/**
 * Reads and parses a package.json file using the FileSystem service.
 * Throws on failure (callers should catch or use Effect.try).
 *
 * @param packageJsonPath - Absolute path to the package.json file
 * @param fs - FileSystem service instance
 * @returns Parsed package.json object
 */
export function readPackageJsonWithFs(
	packageJsonPath: string,
	fs: FileSystemService,
): Record<string, unknown> {
	if (!fs.existsSync(packageJsonPath)) {
		throw new Error(`package.json not found at ${packageJsonPath}`);
	}

	const content = fs.readFileSync(packageJsonPath, "utf-8");
	return JSON.parse(content) as Record<string, unknown>;
}
