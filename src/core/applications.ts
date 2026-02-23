import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { type ArkErrors, type } from "arktype";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
	archiveApplication as archiveAppService,
	createApplication,
	createRelease as createReleaseService,
	disableApplication as disableAppService,
	enableApplication as enableAppService,
	getApplication,
	getApplicationAndLatestRelease,
	updateApplication as updateAppService,
} from "../services/applications";
import {
	type ActionConfig,
	type SubscriptionConfig,
	createConfigFile,
	createEnvFile,
	getConfigFile,
	getExtensionsFromConfig,
} from "../services/config";
import { bundleExtension } from "../services/extension/bundler";
import { getUploadTarget } from "../services/extension/presigned-url";
import { scanBundle, scanExtension } from "../services/extension/security-scan";
import { uploadArtifact } from "../services/extension/upload";
import {
	AuthenticationError,
	type CmdResult,
	ConfigurationError,
	NetworkError,
	ValidationError,
} from "../shared/types";
import { getFromKeychain } from "./auth";
import type { Environment } from "./environment";
import type { ScanReport } from "./security/types";

// Type definitions for core application functions
export interface ApplicationInfo {
	id: string;
	label: string;
	name: string;
	description: string;
	status: string;
	url: string;
	proxyUrl: string;
	authorizationScopes?: string[];
	releases?: Array<{
		id: string;
		version: string;
		description?: string;
		createdAt: string;
	}>;
}

export interface Application {
	id: string;
	label: string;
	name: string;
	description: string;
	status: string;
	url: string;
	proxyUrl: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export interface UpdateApplicationInput {
	label?: string;
	description?: string;
	status?: "ACTIVE" | "INACTIVE";
}

export interface CreateApplicationInput {
	name: string;
	description: string;
	url: string;
	proxyUrl: string;
	authorizationScopes: string[];
}

export interface CreatedApplicationInfo {
	id: string;
	clientId: string;
	clientSecret: string;
	name: string;
	description: string;
	status: string;
	url: string;
	proxyUrl: string;
	authorizationScopes: string[];
	secret: string;
	publicKey: string;
}

// Input validation schemas
const updateApplicationInputValidator = type({
	label: "string?",
	description: "string?",
	status: '"ACTIVE" | "INACTIVE"?',
});

const createApplicationInputValidator = type({
	name: "string",
	description: "string",
	url: type.keywords.string.url.root,
	proxyUrl: type.keywords.string.url.root,
	authorizationScopes: type.string.array().moreThanLength(0),
});

function isConfigValidationErrorResult(
	value: ReturnType<typeof getConfigFile>,
): value is ArkErrors {
	return typeof value === "object" && value !== null && "summary" in value;
}

/**
 * Initialize/create a new application
 */
async function applicationInitPromise(
	input: CreateApplicationInput,
	environment?: Environment,
): Promise<CmdResult<CreatedApplicationInfo>> {
	try {
		// Validate input
		const validationResult = createApplicationInputValidator(input);
		if (validationResult instanceof type.errors) {
			return {
				success: false,
				error: new ValidationError(
					validationResult.summary,
					"Invalid application configuration",
				),
			};
		}

		const accessToken = await getFromKeychain("token");
		if (!accessToken) {
			return {
				success: false,
				error: new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			};
		}

		// Call service function with proper format
		const createInput = {
			label: input.name,
			name: input.name,
			description: input.description,
			url: input.url,
			proxyUrl: input.proxyUrl,
			authorizationScopes: input.authorizationScopes,
		};

		const result = await createApplication(createInput, { accessToken });

		if (!result.createApplication) {
			return {
				success: false,
				error: new NetworkError(
					"Failed to create application",
					"Application creation failed - no data returned",
				),
			};
		}

		const app = result.createApplication;
		const createdApp: CreatedApplicationInfo = {
			id: app.id,
			clientId: String(app.clientId || ""),
			clientSecret: String(app.clientSecret || ""),
			name: app.name,
			description: app.description || "",
			status: app.status,
			url: app.url,
			proxyUrl: app.proxyUrl,
			authorizationScopes: app.authorizationScopes || [],
			secret: String(app.secret || ""),
			publicKey: String(app.publicKey || ""),
		};

		// Create config and env files
		try {
			await createConfigFile(
				{
					client_id: createdApp.clientId,
					name: createdApp.name,
					description: createdApp.description,
					url: createdApp.url,
					proxy_url: createdApp.proxyUrl,
					authorization_scopes: createdApp.authorizationScopes,
					version: "0.0.0",
					actions: [],
					subscriptions: { webhook: [] },
				},
				environment,
			);

			await createEnvFile(
				{
					secret: createdApp.secret,
					publicKey: createdApp.publicKey,
					clientId: createdApp.clientId,
					clientSecret: createdApp.clientSecret,
				},
				environment,
			);
		} catch (fileError) {
			// Ignore file generation errors without affecting API-level operation.
		}

		return {
			success: true,
			data: createdApp,
		};
	} catch (error) {
		return {
			success: false,
			error: new NetworkError(
				`Failed to create application: ${error}`,
				error as Error,
			),
		};
	}
}

/**
 * Get application information by name
 */
async function applicationInfoPromise(
	name?: string,
): Promise<CmdResult<ApplicationInfo>> {
	try {
		if (!name) {
			return {
				success: false,
				error: new ValidationError(
					"Application name is required",
					"Please specify an application name",
				),
			};
		}

		const accessToken = await getFromKeychain("token");
		if (!accessToken) {
			return {
				success: false,
				error: new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			};
		}

		const result = await getApplicationAndLatestRelease(name, { accessToken });

		if (!result.application) {
			return {
				success: false,
				error: new ValidationError(
					`Application '${name}' not found`,
					`Application '${name}' does not exist`,
				),
			};
		}

		const app = result.application;
		const applicationInfo: ApplicationInfo = {
			id: app.id,
			label: app.label,
			name: app.name,
			description: app.description,
			status: app.status,
			url: app.url,
			proxyUrl: app.proxyUrl,
			authorizationScopes: app.authorizationScopes,
			releases: app.releases || [],
		};

		return {
			success: true,
			data: applicationInfo,
		};
	} catch (error) {
		return {
			success: false,
			error: new NetworkError(
				`Failed to get application info: ${error}`,
				error as Error,
			),
		};
	}
}

/**
 * List all applications (placeholder - needs query implementation)
 */
async function applicationListPromise(): Promise<CmdResult<Application[]>> {
	return {
		success: false,
		error: new ConfigurationError(
			"Application listing not available",
			"The GraphQL API does not support listing all applications. Use 'application info <name>' for specific applications.",
		),
	};
}

/**
 * Validate application configuration
 */
async function applicationValidatePromise(
	name?: string,
): Promise<CmdResult<ValidationResult>> {
	try {
		if (!name) {
			return {
				success: false,
				error: new ValidationError(
					"Application name is required",
					"Please specify an application name",
				),
			};
		}

		const accessToken = await getFromKeychain("token");
		if (!accessToken) {
			return {
				success: false,
				error: new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			};
		}

		// Get application to validate it exists and check basic properties
		const result = await getApplication(name, { accessToken });

		if (!result.application) {
			return {
				success: false,
				error: new ValidationError(
					`Application '${name}' not found`,
					`Application '${name}' does not exist`,
				),
			};
		}

		const app = result.application;
		const errors: string[] = [];
		const warnings: string[] = [];

		// Basic validation checks
		if (!app.url) {
			errors.push("Application URL is required");
		}
		if (!app.proxyUrl) {
			warnings.push("Proxy URL is not set");
		}
		if (app.status === "INACTIVE") {
			warnings.push("Application is currently inactive");
		}

		const validationResult: ValidationResult = {
			valid: errors.length === 0,
			errors,
			warnings,
		};

		return {
			success: true,
			data: validationResult,
		};
	} catch (error) {
		return {
			success: false,
			error: new NetworkError(
				`Failed to validate application: ${error}`,
				error as Error,
			),
		};
	}
}

/**
 * Update application configuration
 */
async function applicationUpdatePromise(
	name: string,
	config: UpdateApplicationInput,
): Promise<CmdResult<void>> {
	try {
		if (!name) {
			return {
				success: false,
				error: new ValidationError(
					"Application name is required",
					"Please specify an application name",
				),
			};
		}

		// Validate input
		const validationResult = updateApplicationInputValidator(config);
		if (validationResult instanceof type.errors) {
			return {
				success: false,
				error: new ValidationError(
					validationResult.summary,
					"Invalid update configuration",
				),
			};
		}

		const accessToken = await getFromKeychain("token");
		if (!accessToken) {
			return {
				success: false,
				error: new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			};
		}

		// Get application ID first
		const appResult = await getApplication(name, { accessToken });
		if (!appResult.application) {
			return {
				success: false,
				error: new ValidationError(
					`Application '${name}' not found`,
					`Application '${name}' does not exist`,
				),
			};
		}

		await updateAppService(appResult.application.id, config, { accessToken });

		return {
			success: true,
		};
	} catch (error) {
		return {
			success: false,
			error: new NetworkError(
				`Failed to update application: ${error}`,
				error as Error,
			),
		};
	}
}

/**
 * Enable application on a store
 */
async function applicationEnablePromise(
	name: string,
	storeId?: string,
): Promise<CmdResult<void>> {
	try {
		if (!name) {
			return {
				success: false,
				error: new ValidationError(
					"Application name is required",
					"Please specify an application name",
				),
			};
		}

		if (!storeId) {
			return {
				success: false,
				error: new ValidationError(
					"Store ID is required",
					"Please specify a store ID",
				),
			};
		}

		const accessToken = await getFromKeychain("token");
		if (!accessToken) {
			return {
				success: false,
				error: new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			};
		}

		await enableAppService({ applicationName: name, storeId }, { accessToken });

		return {
			success: true,
		};
	} catch (error) {
		return {
			success: false,
			error: new NetworkError(
				`Failed to enable application: ${error}`,
				error as Error,
			),
		};
	}
}

/**
 * Disable application on a store
 */
async function applicationDisablePromise(
	name: string,
	storeId?: string,
): Promise<CmdResult<void>> {
	try {
		if (!name) {
			return {
				success: false,
				error: new ValidationError(
					"Application name is required",
					"Please specify an application name",
				),
			};
		}

		if (!storeId) {
			return {
				success: false,
				error: new ValidationError(
					"Store ID is required",
					"Please specify a store ID",
				),
			};
		}

		const accessToken = await getFromKeychain("token");
		if (!accessToken) {
			return {
				success: false,
				error: new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			};
		}

		await disableAppService(
			{ applicationName: name, storeId },
			{ accessToken },
		);

		return {
			success: true,
		};
	} catch (error) {
		return {
			success: false,
			error: new NetworkError(
				`Failed to disable application: ${error}`,
				error as Error,
			),
		};
	}
}

/**
 * Archive application
 */
async function applicationArchivePromise(
	name: string,
): Promise<CmdResult<void>> {
	try {
		if (!name) {
			return {
				success: false,
				error: new ValidationError(
					"Application name is required",
					"Please specify an application name",
				),
			};
		}

		const accessToken = await getFromKeychain("token");
		if (!accessToken) {
			return {
				success: false,
				error: new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			};
		}

		// Get application ID first
		const appResult = await getApplication(name, { accessToken });
		if (!appResult.application) {
			return {
				success: false,
				error: new ValidationError(
					`Application '${name}' not found`,
					`Application '${name}' does not exist`,
				),
			};
		}

		await archiveAppService(appResult.application.id, { accessToken });

		return {
			success: true,
		};
	} catch (error) {
		return {
			success: false,
			error: new NetworkError(
				`Failed to archive application: ${error}`,
				error as Error,
			),
		};
	}
}

export interface CreateReleaseInput {
	applicationName: string;
	version: string;
	description?: string;
	configPath?: string;
	env?: string;
}

export interface ReleaseInfo {
	id: string;
	version: string;
	description?: string;
	createdAt: string;
}

/**
 * Create a new release for an application
 */
async function applicationReleasePromise(
	input: CreateReleaseInput,
): Promise<CmdResult<ReleaseInfo>> {
	try {
		const accessToken = await getFromKeychain("token");

		if (!accessToken) {
			return {
				success: false,
				error: new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			};
		}

		// Get application information first
		const appResult = await getApplication(input.applicationName, {
			accessToken,
		});
		if (!appResult.application) {
			return {
				success: false,
				error: new ValidationError(
					`Application '${input.applicationName}' not found`,
					`Application '${input.applicationName}' does not exist`,
				),
			};
		}

		// Load configuration to get actions and subscriptions
		let actions: ActionConfig[] = [];
		let subscriptions: SubscriptionConfig[] = [];

		try {
			const config = getConfigFile({
				configPath: input.configPath,
				env: input.env as Environment,
			});

			if (!isConfigValidationErrorResult(config)) {
				actions = config.actions || [];
				subscriptions = config.subscriptions?.webhook || [];
			}
		} catch (configError) {
			// Config file might not exist, that's okay, just continue without actions/subscriptions
		}

		const releaseData = {
			applicationId: appResult.application.id,
			version: input.version,
			description: input.description,
			actions,
			subscriptions,
		};

		const result = await createReleaseService(releaseData, { accessToken });

		return {
			success: true,
			data: {
				id: result.createRelease.id,
				version: result.createRelease.version,
				description: result.createRelease.description,
				createdAt: result.createRelease.createdAt,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: new NetworkError(
				`Failed to create release: ${error}`,
				error as Error,
			),
		};
	}
}

export interface ExtensionSecurityReport {
	extensionName: string;
	extensionDir: string;
	scannedFiles: number;
	totalFindings: number;
	blockedFindings: number;
	warnings: number;
	blocked: boolean;
	preBundleReport: ScanReport;
	postBundleReport?: ScanReport;
}

export interface ExtensionBundleReport {
	extensionName: string;
	artifactName: string;
	artifactPath: string;
	size: number;
	sha256: string;
	/** Upload IDs - one per target (or single ID if no targets) */
	uploadIds?: string[];
	/** Targets that were uploaded */
	targets?: string[];
	uploaded?: boolean;
}

export interface DeployResult {
	securityReports: ExtensionSecurityReport[];
	bundleReports: ExtensionBundleReport[];
	totalExtensions: number;
	blockedExtensions: number;
}

export interface DeployProgressEvent {
	type: "step" | "progress";
	name: string;
	status?: "started" | "completed" | "failed";
	message?: string;
	extensionName?: string;
	percent?: number;
	details?: Record<string, unknown>;
}

export interface DeployOptions {
	configPath?: string;
	env?: Environment;
	onProgress?: (event: DeployProgressEvent) => void;
}

function emitDeployProgress(
	options: DeployOptions | undefined,
	event: DeployProgressEvent,
): void {
	if (typeof options?.onProgress !== "function") {
		return;
	}

	try {
		options.onProgress(event);
	} catch {
		// Progress callbacks are best-effort and must not affect deployment.
	}
}

function tryNetworkPromise<A>(
	thunk: () => Promise<A>,
	message: string,
): Effect.Effect<A, NetworkError> {
	return Effect.tryPromise({
		try: thunk,
		catch: (error) => new NetworkError(message, error),
	});
}

function cleanupBundleArtifacts(
	artifactPath: string,
	sourcemapPath?: string,
): Effect.Effect<void> {
	return Effect.gen(function* () {
		yield* Effect.tryPromise({
			try: () => rm(artifactPath, { force: true }),
			catch: () => undefined,
		}).pipe(Effect.ignore);

		if (sourcemapPath) {
			yield* Effect.tryPromise({
				try: () => rm(sourcemapPath, { force: true }),
				catch: () => undefined,
			}).pipe(Effect.ignore);
		}
	});
}

/**
 * Deploy an application (change status to ACTIVE)
 * Performs security scan, bundling, and upload before deployment
 *
 * Prerequisites:
 * - Application must have at least one release created via `application release` command
 *
 * Flow:
 * 1. Get application and verify it exists
 * 2. Validate that application has a release
 * 3. Discover extensions in workspace
 * 4. Security scan each extension (Phase 1.5)
 * 5. Bundle each extension (Phase 2)
 * 6. Post-bundle security scan (Phase 2.5)
 * 7. Get presigned upload URLs (Phase 3)
 * 8. Upload artifacts to S3 (Phase 4)
 * 9. Update application status to ACTIVE
 */
export function applicationDeployEffect(
	applicationName: string,
	options?: DeployOptions,
): Effect.Effect<
	DeployResult,
	AuthenticationError | ValidationError | NetworkError
> {
	return Effect.gen(function* () {
		emitDeployProgress(options, {
			type: "step",
			name: "deploy",
			status: "started",
			message: `Starting deployment for '${applicationName}'`,
		});

		emitDeployProgress(options, {
			type: "step",
			name: "auth.check",
			status: "started",
		});
		const accessToken = yield* tryNetworkPromise(
			() => getFromKeychain("token"),
			"Failed to read authentication token",
		);

		if (!accessToken) {
			emitDeployProgress(options, {
				type: "step",
				name: "auth.check",
				status: "failed",
				message: "Authentication required",
			});
			return yield* Effect.fail(
				new AuthenticationError(
					"Not authenticated",
					"Please run 'godaddy auth login' first",
				),
			);
		}
		emitDeployProgress(options, {
			type: "step",
			name: "auth.check",
			status: "completed",
		});

		// Get application and latest release
		emitDeployProgress(options, {
			type: "step",
			name: "application.lookup",
			status: "started",
		});
		const appResult = yield* tryNetworkPromise(
			() => getApplicationAndLatestRelease(applicationName, { accessToken }),
			`Failed to load application '${applicationName}'`,
		);

		if (!appResult.application) {
			emitDeployProgress(options, {
				type: "step",
				name: "application.lookup",
				status: "failed",
				message: `Application '${applicationName}' not found`,
			});
			return yield* Effect.fail(
				new ValidationError(
					`Application '${applicationName}' not found`,
					`Application '${applicationName}' does not exist`,
				),
			);
		}
		emitDeployProgress(options, {
			type: "step",
			name: "application.lookup",
			status: "completed",
		});

		const applicationId = appResult.application.id;

		// Validate that a release exists
		emitDeployProgress(options, {
			type: "step",
			name: "release.lookup",
			status: "started",
		});
		const releases = appResult.application.releases?.edges;
		if (!releases || releases.length === 0) {
			emitDeployProgress(options, {
				type: "step",
				name: "release.lookup",
				status: "failed",
				message: "No release found for application",
			});
			return yield* Effect.fail(
				new ValidationError(
					"No release found for application",
					`Application '${applicationName}' has no releases. Create a release first with: godaddy application release ${applicationName} --release-version <version>`,
				),
			);
		}

		const latestRelease = releases[0].node;
		if (!latestRelease) {
			emitDeployProgress(options, {
				type: "step",
				name: "release.lookup",
				status: "failed",
				message: "Invalid release data",
			});
			return yield* Effect.fail(
				new ValidationError(
					"Invalid release data",
					"Unable to retrieve release information",
				),
			);
		}
		emitDeployProgress(options, {
			type: "step",
			name: "release.lookup",
			status: "completed",
		});

		const releaseId = latestRelease.id;

		// Get extensions from config file (source of truth)
		emitDeployProgress(options, {
			type: "step",
			name: "extensions.discover",
			status: "started",
		});
		const repoRoot = process.cwd();
		const extensions = getExtensionsFromConfig({
			configPath: options?.configPath,
			env: options?.env,
		});
		emitDeployProgress(options, {
			type: "step",
			name: "extensions.discover",
			status: "completed",
			details: { totalExtensions: extensions.length },
		});

		const securityReports: ExtensionSecurityReport[] = [];
		let blockedExtensions = 0;

		// If no extensions found, skip security scan and bundling (no-op)
		if (extensions.length === 0) {
			emitDeployProgress(options, {
				type: "step",
				name: "application.activate",
				status: "started",
			});
			// No extensions to scan/bundle, proceed with deployment
			yield* tryNetworkPromise(
				() =>
					updateAppService(
						appResult.application.id,
						{ status: "ACTIVE" },
						{ accessToken },
					),
				`Failed to activate application '${applicationName}'`,
			);
			emitDeployProgress(options, {
				type: "step",
				name: "application.activate",
				status: "completed",
			});
			emitDeployProgress(options, {
				type: "step",
				name: "deploy",
				status: "completed",
				details: { totalExtensions: 0, blockedExtensions: 0 },
			});

			return {
				securityReports: [],
				bundleReports: [],
				totalExtensions: 0,
				blockedExtensions: 0,
			};
		}

		// Scan each extension (scan the directory containing the source file)
		// Extensions live at extensions/{handle}/ and source is relative to that
		for (const [index, extension] of extensions.entries()) {
			const extensionDir = resolve(repoRoot, "extensions", extension.handle);
			emitDeployProgress(options, {
				type: "step",
				name: "scan.prebundle",
				status: "started",
				extensionName: extension.name,
				details: { extensionDir },
			});

			const scanResult = yield* tryNetworkPromise(
				() => scanExtension(extensionDir),
				`Security scan failed for extension '${extension.name}'`,
			);

			if (!scanResult.success || !scanResult.data) {
				emitDeployProgress(options, {
					type: "step",
					name: "scan.prebundle",
					status: "failed",
					extensionName: extension.name,
					message: scanResult.error?.message || "Unable to perform security scan",
				});
				return yield* Effect.fail(
					new ValidationError(
						`Security scan failed for extension '${extension.name}'`,
						scanResult.error?.message || "Unable to perform security scan",
					),
				);
			}

			const report = scanResult.data;
			emitDeployProgress(options, {
				type: "step",
				name: "scan.prebundle",
				status: "completed",
				extensionName: extension.name,
				details: {
					totalFindings: report.summary.total,
					blockedFindings: report.summary.bySeverity.block,
					warnings: report.summary.bySeverity.warn,
				},
			});
			emitDeployProgress(options, {
				type: "progress",
				name: "scan.prebundle",
				percent: Math.round(((index + 1) / extensions.length) * 100),
				message: `Scanned ${index + 1}/${extensions.length} extension(s)`,
			});

			if (report.blocked) {
				blockedExtensions++;
			}

			securityReports.push({
				extensionName: extension.name,
				extensionDir,
				scannedFiles: report.scannedFiles,
				totalFindings: report.summary.total,
				blockedFindings: report.summary.bySeverity.block,
				warnings: report.summary.bySeverity.warn,
				blocked: report.blocked,
				preBundleReport: report,
			});
		}

		// If any extension has blocking issues, fail deployment
		if (blockedExtensions > 0) {
			emitDeployProgress(options, {
				type: "step",
				name: "scan.prebundle",
				status: "failed",
				message: `${blockedExtensions} extension(s) blocked by security scan`,
				details: { blockedExtensions },
			});
			return yield* Effect.fail(
				new ValidationError(
					"Security violations detected",
					`${blockedExtensions} extension(s) blocked due to security violations. Deployment blocked.`,
				),
			);
		}

		// Bundle each extension
		const bundleReports: ExtensionBundleReport[] = [];
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

		for (const [index, extension] of extensions.entries()) {
			const extensionDir = resolve(repoRoot, "extensions", extension.handle);
			const sourcePath = resolve(extensionDir, extension.source);
			emitDeployProgress(options, {
				type: "step",
				name: "bundle",
				status: "started",
				extensionName: extension.name,
				details: { sourcePath },
			});

			const bundleResult = yield* tryNetworkPromise(
				() =>
					bundleExtension(
						{ name: extension.handle, version: undefined },
						sourcePath,
						{ repoRoot, timestamp, extensionDir, extensionType: extension.type },
					),
				`Bundle failed for extension '${extension.name}'`,
			);

			if (!bundleResult.success || !bundleResult.data) {
				emitDeployProgress(options, {
					type: "step",
					name: "bundle",
					status: "failed",
					extensionName: extension.name,
					message: bundleResult.error?.message || "Unable to bundle extension",
				});
				return yield* Effect.fail(
					new ValidationError(
						`Bundle failed for extension '${extension.name}'`,
						bundleResult.error?.message || "Unable to bundle extension",
					),
				);
			}

			const bundle = bundleResult.data;
			emitDeployProgress(options, {
				type: "step",
				name: "bundle",
				status: "completed",
				extensionName: extension.name,
				details: {
					artifactName: bundle.artifactName,
					size: bundle.size,
				},
			});

			// Post-bundle security scan
			emitDeployProgress(options, {
				type: "step",
				name: "scan.postbundle",
				status: "started",
				extensionName: extension.name,
				details: { artifactName: bundle.artifactName },
			});
			const postScanResult = yield* tryNetworkPromise(
				() => scanBundle(bundle.artifactPath),
				`Post-bundle security scan failed for extension '${extension.name}'`,
			);

			// Cleanup on scan failure
			if (!postScanResult.success) {
				yield* cleanupBundleArtifacts(bundle.artifactPath, bundle.sourcemapPath);
				emitDeployProgress(options, {
					type: "step",
					name: "scan.postbundle",
					status: "failed",
					extensionName: extension.name,
					message:
						postScanResult.error?.message || "Unable to scan bundled artifact",
				});
				return yield* Effect.fail(
					new ValidationError(
						`Post-bundle security scan failed for extension '${extension.name}'`,
						postScanResult.error?.message || "Unable to scan bundled artifact",
					),
				);
			}

			// Cleanup and block deployment if security violations found
			if (postScanResult.data?.blocked) {
				yield* cleanupBundleArtifacts(bundle.artifactPath, bundle.sourcemapPath);
				emitDeployProgress(options, {
					type: "step",
					name: "scan.postbundle",
					status: "failed",
					extensionName: extension.name,
					message: "Security violations detected in bundled artifact",
					details: {
						totalFindings: postScanResult.data.summary.total,
						blockedFindings: postScanResult.data.summary.bySeverity.block,
					},
				});
				return yield* Effect.fail(
					new ValidationError(
						`Security violations detected in bundled code for extension '${extension.name}'`,
						`${postScanResult.data.findings.length} security violation(s) found. Deployment blocked.`,
					),
				);
			}
			emitDeployProgress(options, {
				type: "step",
				name: "scan.postbundle",
				status: "completed",
				extensionName: extension.name,
				details: {
					totalFindings: postScanResult.data?.summary.total ?? 0,
					blockedFindings: postScanResult.data?.summary.bySeverity.block ?? 0,
				},
			});

			const extensionSecurityReport = securityReports.find(
				(report) => report.extensionDir === extensionDir,
			);
			if (extensionSecurityReport && postScanResult.data) {
				extensionSecurityReport.postBundleReport = postScanResult.data;
			}

			// Get presigned upload URL(s) and upload (Phase 3 & 4)
			// For blocks extensions, use "blocks" as target
			// For extensions with targets, upload once per target
			const targets =
				extension.type === "blocks"
					? ["blocks"]
					: extension.targets?.length
						? extension.targets.map((t) => t.target)
						: [undefined]; // No targets = single upload without target info

			const uploadIds: string[] = [];
			let uploaded = false;

			emitDeployProgress(options, {
				type: "step",
				name: "upload",
				status: "started",
				extensionName: extension.name,
				details: { targetCount: targets.length },
			});
			for (const target of targets) {
				const uploadTarget = yield* tryNetworkPromise(
					() =>
						getUploadTarget(
							{
								applicationId,
								releaseId,
								contentType: "JS",
								target,
							},
							accessToken,
						),
					`Upload target lookup failed for extension '${extension.name}'`,
				);

				uploadIds.push(uploadTarget.uploadId);

				// Upload to S3 (Phase 4)
				yield* tryNetworkPromise(
					() =>
						uploadArtifact(uploadTarget, bundle.artifactPath, {
							contentType: "application/javascript",
						}),
					`Upload failed for extension '${extension.name}'`,
				);
			}

			uploaded = true;
			emitDeployProgress(options, {
				type: "step",
				name: "upload",
				status: "completed",
				extensionName: extension.name,
				details: { uploadCount: uploadIds.length },
			});
			emitDeployProgress(options, {
				type: "progress",
				name: "bundle.upload",
				percent: Math.round(((index + 1) / extensions.length) * 100),
				message: `Bundled and uploaded ${index + 1}/${extensions.length} extension(s)`,
			});

			// Clean up artifacts after successful upload
			yield* cleanupBundleArtifacts(bundle.artifactPath, bundle.sourcemapPath);

			bundleReports.push({
				extensionName: extension.name,
				artifactName: bundle.artifactName,
				artifactPath: bundle.artifactPath,
				size: bundle.size,
				sha256: bundle.sha256,
				uploadIds,
				targets:
					extension.type === "blocks"
						? ["blocks"]
						: extension.targets?.map((t) => t.target),
				uploaded,
			});
		}

		// Update application status to ACTIVE
		emitDeployProgress(options, {
			type: "step",
			name: "application.activate",
			status: "started",
		});
		yield* tryNetworkPromise(
			() =>
				updateAppService(appResult.application.id, { status: "ACTIVE" }, { accessToken }),
			`Failed to activate application '${applicationName}'`,
		);
		emitDeployProgress(options, {
			type: "step",
			name: "application.activate",
			status: "completed",
		});
		emitDeployProgress(options, {
			type: "step",
			name: "deploy",
			status: "completed",
			details: {
				totalExtensions: extensions.length,
				blockedExtensions,
			},
		});

		return {
			securityReports,
			bundleReports,
			totalExtensions: extensions.length,
			blockedExtensions,
		};
	}).pipe(
		Effect.tapError((error) =>
			Effect.sync(() => {
				emitDeployProgress(options, {
					type: "step",
					name: "deploy",
					status: "failed",
					message:
						error instanceof Error
							? "userMessage" in error &&
							  typeof error.userMessage === "string"
								? error.userMessage
								: error.message
							: "Unknown deploy error",
				});
			}),
		),
	);
}

async function applicationDeployPromise(
	applicationName: string,
	options?: DeployOptions,
): Promise<CmdResult<DeployResult>> {
	const exit = await Effect.runPromiseExit(
		applicationDeployEffect(applicationName, options),
	);

	if (Exit.isSuccess(exit)) {
		return {
			success: true,
			data: exit.value,
		};
	}

	const failure = Cause.squash(exit.cause);
	if (
		failure instanceof AuthenticationError ||
		failure instanceof ValidationError ||
		failure instanceof NetworkError
	) {
		return {
			success: false,
			error: failure,
		};
	}

	return {
		success: false,
		error: new NetworkError(
			`Failed to deploy application: ${String(failure)}`,
			failure,
		),
	};
}

export function applicationInitEffect(...args: Parameters<typeof applicationInitPromise>): Effect.Effect<Awaited<ReturnType<typeof applicationInitPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationInitPromise(...args),
		catch: (error) => error,
	});
}

export function applicationInfoEffect(...args: Parameters<typeof applicationInfoPromise>): Effect.Effect<Awaited<ReturnType<typeof applicationInfoPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationInfoPromise(...args),
		catch: (error) => error,
	});
}

export function applicationListEffect(...args: Parameters<typeof applicationListPromise>): Effect.Effect<Awaited<ReturnType<typeof applicationListPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationListPromise(...args),
		catch: (error) => error,
	});
}

export function applicationValidateEffect(...args: Parameters<typeof applicationValidatePromise>): Effect.Effect<Awaited<ReturnType<typeof applicationValidatePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationValidatePromise(...args),
		catch: (error) => error,
	});
}

export function applicationUpdateEffect(...args: Parameters<typeof applicationUpdatePromise>): Effect.Effect<Awaited<ReturnType<typeof applicationUpdatePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationUpdatePromise(...args),
		catch: (error) => error,
	});
}

export function applicationEnableEffect(...args: Parameters<typeof applicationEnablePromise>): Effect.Effect<Awaited<ReturnType<typeof applicationEnablePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationEnablePromise(...args),
		catch: (error) => error,
	});
}

export function applicationDisableEffect(...args: Parameters<typeof applicationDisablePromise>): Effect.Effect<Awaited<ReturnType<typeof applicationDisablePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationDisablePromise(...args),
		catch: (error) => error,
	});
}

export function applicationArchiveEffect(...args: Parameters<typeof applicationArchivePromise>): Effect.Effect<Awaited<ReturnType<typeof applicationArchivePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationArchivePromise(...args),
		catch: (error) => error,
	});
}

export function applicationReleaseEffect(...args: Parameters<typeof applicationReleasePromise>): Effect.Effect<Awaited<ReturnType<typeof applicationReleasePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => applicationReleasePromise(...args),
		catch: (error) => error,
	});
}

export function applicationInit(
	...args: Parameters<typeof applicationInitPromise>
): Promise<Awaited<ReturnType<typeof applicationInitPromise>>> {
	return Effect.runPromise(applicationInitEffect(...args));
}

export function applicationInfo(
	...args: Parameters<typeof applicationInfoPromise>
): Promise<Awaited<ReturnType<typeof applicationInfoPromise>>> {
	return Effect.runPromise(applicationInfoEffect(...args));
}

export function applicationList(
	...args: Parameters<typeof applicationListPromise>
): Promise<Awaited<ReturnType<typeof applicationListPromise>>> {
	return Effect.runPromise(applicationListEffect(...args));
}

export function applicationValidate(
	...args: Parameters<typeof applicationValidatePromise>
): Promise<Awaited<ReturnType<typeof applicationValidatePromise>>> {
	return Effect.runPromise(applicationValidateEffect(...args));
}

export function applicationUpdate(
	...args: Parameters<typeof applicationUpdatePromise>
): Promise<Awaited<ReturnType<typeof applicationUpdatePromise>>> {
	return Effect.runPromise(applicationUpdateEffect(...args));
}

export function applicationEnable(
	...args: Parameters<typeof applicationEnablePromise>
): Promise<Awaited<ReturnType<typeof applicationEnablePromise>>> {
	return Effect.runPromise(applicationEnableEffect(...args));
}

export function applicationDisable(
	...args: Parameters<typeof applicationDisablePromise>
): Promise<Awaited<ReturnType<typeof applicationDisablePromise>>> {
	return Effect.runPromise(applicationDisableEffect(...args));
}

export function applicationArchive(
	...args: Parameters<typeof applicationArchivePromise>
): Promise<Awaited<ReturnType<typeof applicationArchivePromise>>> {
	return Effect.runPromise(applicationArchiveEffect(...args));
}

export function applicationRelease(
	...args: Parameters<typeof applicationReleasePromise>
): Promise<Awaited<ReturnType<typeof applicationReleasePromise>>> {
	return Effect.runPromise(applicationReleaseEffect(...args));
}

export function applicationDeploy(
	...args: Parameters<typeof applicationDeployPromise>
): Promise<Awaited<ReturnType<typeof applicationDeployPromise>>> {
	return applicationDeployPromise(...args);
}
