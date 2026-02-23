import * as nodeFs from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { ConfigurationError } from "../../effect/errors";

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
 */
export function getExtensionsEffect(
	options?: DetectExtensionsOptions,
): Effect.Effect<ExtensionPackage[], ConfigurationError> {
	return Effect.gen(function* () {
		const repoRoot = options?.repoRoot ?? process.cwd();
		const extensionsDir = options?.extensionsDir ?? "extensions";
		const extensionsPath = join(repoRoot, extensionsDir);

		const packageManager = detectPackageManager(repoRoot);

		if (nodeFs.existsSync(extensionsPath)) {
			const stats = nodeFs.statSync(extensionsPath);
			if (!stats.isDirectory()) {
				return yield* Effect.fail(
					new ConfigurationError({
						message: `Extensions path ${extensionsPath} exists but is not a directory`,
						userMessage: "Failed to detect workspace extensions",
					}),
				);
			}

			const entries = nodeFs.readdirSync(extensionsPath, {
				withFileTypes: true,
			});
			const extensions: ExtensionPackage[] = [];

			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue;
				}

				const extensionDir = join(extensionsPath, entry.name);
				const packageJsonPath = join(extensionDir, "package.json");

				if (!nodeFs.existsSync(packageJsonPath)) {
					continue;
				}

				const packageJson = readPackageJson(packageJsonPath);

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
		if (!nodeFs.existsSync(rootPackageJsonPath)) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: `No extensions directory found at ${extensionsPath} and no package.json found at repository root`,
					userMessage: "Failed to detect workspace extensions",
				}),
			);
		}

		const rootPackageJson = readPackageJson(rootPackageJsonPath);
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

		const extensions: ExtensionPackage[] = [];

		for (const workspace of workspaces) {
			const workspacePaths: string[] = [];

			if (workspace.includes("*")) {
				const baseDir = workspace.replace("/*", "");
				const basePath = join(repoRoot, baseDir);

				if (nodeFs.existsSync(basePath) && nodeFs.statSync(basePath).isDirectory()) {
					const entries = nodeFs.readdirSync(basePath, {
						withFileTypes: true,
					});
					for (const entry of entries) {
						if (entry.isDirectory()) {
							workspacePaths.push(join(basePath, entry.name));
						}
					}
				}
			} else {
				workspacePaths.push(join(repoRoot, workspace));
			}

			for (const workspacePath of workspacePaths) {
				const packageJsonPath = join(workspacePath, "package.json");

				if (!nodeFs.existsSync(packageJsonPath)) {
					continue;
				}

				let packageJson: Record<string, unknown>;
				try {
					packageJson = readPackageJson(packageJsonPath);
				} catch {
					continue;
				}

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
					continue;
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
 * Uses node:fs directly since this is a sync utility.
 */
export function detectPackageManager(repoRoot: string): PackageManager {
	const rootPackageJsonPath = join(repoRoot, "package.json");
	if (nodeFs.existsSync(rootPackageJsonPath)) {
		try {
			const pkg = readPackageJson(rootPackageJsonPath);
			const packageManager = pkg.packageManager as string | undefined;
			if (packageManager) {
				if (packageManager.startsWith("pnpm")) return "pnpm";
				if (packageManager.startsWith("yarn")) return "yarn";
				if (packageManager.startsWith("npm")) return "npm";
			}
		} catch {
			// Fall through to lockfile detection
		}
	}

	if (nodeFs.existsSync(join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
	if (nodeFs.existsSync(join(repoRoot, "yarn.lock"))) return "yarn";
	if (nodeFs.existsSync(join(repoRoot, "package-lock.json"))) return "npm";

	return "unknown";
}

/**
 * Reads and parses a package.json file using node:fs.
 */
export function readPackageJson(
	packageJsonPath: string,
): Record<string, unknown> {
	if (!nodeFs.existsSync(packageJsonPath)) {
		throw new Error(`package.json not found at ${packageJsonPath}`);
	}

	const content = nodeFs.readFileSync(packageJsonPath, "utf-8");
	return JSON.parse(content) as Record<string, unknown>;
}
