import { join } from "node:path";
import * as TOML from "@iarna/toml";
import { type ArkErrors, type } from "arktype";
import * as Effect from "effect/Effect";
import type { Environment } from "../core/environment";
import { ConfigurationError } from "../effect/errors";
import { FileSystem, type FileSystemService } from "../effect/services/filesystem";

function readProxyUrl(root: unknown): string | undefined {
	if (typeof root !== "object" || root === null) {
		return undefined;
	}

	const proxyUrl = (root as { proxy_url?: unknown }).proxy_url;
	return typeof proxyUrl === "string" ? proxyUrl : undefined;
}

const Endpoint = type("string").narrow((endpoint: string, ctx) => {
	const proxyUrl = readProxyUrl(ctx.root);
	if (!proxyUrl) {
		return ctx.mustBe("valid endpoint");
	}

	try {
		new URL(endpoint, proxyUrl);
	} catch (error) {
		return ctx.mustBe("valid endpoint");
	}

	return true;
});

const SubscriptionConfig = type({
	name: type.string.atLeastLength(3),
	events: type.string.array().atLeastLength(1),
	url: Endpoint,
});

export type SubscriptionConfig = typeof SubscriptionConfig.infer;

const SubscriptionsType = type({
	webhook: SubscriptionConfig.array(),
});

export type SubscriptionsType = typeof SubscriptionsType.infer;

const ActionConfig = type({
	name: type.string.atLeastLength(3),
	url: Endpoint,
});

export type ActionConfig = typeof ActionConfig.infer;

const DependencyConfig = type({
	name: type.string.atLeastLength(3),
	version: type.keywords.string.semver.optional(),
});

export type DependencyConfig = typeof DependencyConfig.infer;

const DependenciesType = type({
	app: DependencyConfig.array().optional(),
	feature: DependencyConfig.array().optional(),
});

export type DependenciesType = typeof DependenciesType.infer;

const ExtensionTarget = type({
	target: type.string.atLeastLength(1),
});

export type ExtensionTarget = typeof ExtensionTarget.infer;

const EmbedExtensionConfig = type({
	name: type.string.atLeastLength(3),
	handle: type.string.atLeastLength(3),
	source: type.string.atLeastLength(1),
	targets: ExtensionTarget.array().atLeastLength(1),
});

export type EmbedExtensionConfig = typeof EmbedExtensionConfig.infer;

const CheckoutExtensionConfig = type({
	name: type.string.atLeastLength(3),
	handle: type.string.atLeastLength(3),
	source: type.string.atLeastLength(1),
	targets: ExtensionTarget.array().atLeastLength(1),
});

export type CheckoutExtensionConfig = typeof CheckoutExtensionConfig.infer;

const BlocksExtensionConfig = type({
	source: type.string.atLeastLength(1),
});

export type BlocksExtensionConfig = typeof BlocksExtensionConfig.infer;

const ExtensionsType = type({
	embed: EmbedExtensionConfig.array().optional(),
	checkout: CheckoutExtensionConfig.array().optional(),
	blocks: BlocksExtensionConfig.optional(),
});

export type ExtensionsType = typeof ExtensionsType.infer;

export type ExtensionType = "embed" | "checkout" | "blocks";

/**
 * Unified extension info extracted from config for deploy operations
 */
export interface ConfigExtensionInfo {
	/** Extension type (embed, checkout, block) */
	type: ExtensionType;
	/** Extension name */
	name: string;
	/** Extension handle (unique identifier) */
	handle: string;
	/** Path to extension source file (relative to repo root) */
	source: string;
	/** Optional targets for embed/checkout extensions */
	targets?: ExtensionTarget[];
}

/**
 * Extract all extensions from config file as a flat array.
 * This is the source of truth for what extensions should be scanned, bundled, and deployed.
 *
 * @param options - Config file options (configPath, env)
 * @returns Array of extension info objects, or empty array if no extensions defined
 */
export function getExtensionsFromConfig(
	options: { configPath?: string; env?: Environment } = {},
	fs?: FileSystemService,
): ConfigExtensionInfo[] {
	const config = getConfigFile(options, fs);

	if (isConfigValidationErrors(config)) {
		return [];
	}

	const validConfig = config;
	const extensions: ConfigExtensionInfo[] = [];

	if (validConfig.extensions?.embed) {
		for (const ext of validConfig.extensions.embed) {
			if (!ext.name || !ext.handle || !ext.source) {
				throw new Error(
					"Invalid embed extension config: missing required fields (name, handle, source)",
				);
			}
			extensions.push({
				type: "embed",
				name: ext.name,
				handle: ext.handle,
				source: ext.source,
				targets: ext.targets,
			});
		}
	}

	if (validConfig.extensions?.checkout) {
		for (const ext of validConfig.extensions.checkout) {
			if (!ext.name || !ext.handle || !ext.source) {
				throw new Error(
					"Invalid checkout extension config: missing required fields (name, handle, source)",
				);
			}
			extensions.push({
				type: "checkout",
				name: ext.name,
				handle: ext.handle,
				source: ext.source,
				targets: ext.targets,
			});
		}
	}

	if (validConfig.extensions?.blocks) {
		const blocks = validConfig.extensions.blocks;
		if (!blocks.source) {
			throw new Error(
				`Invalid blocks extension config: missing required 'source' field`,
			);
		}
		extensions.push({
			type: "blocks",
			name: "Blocks",
			handle: "blocks",
			source: blocks.source,
		});
	}

	return extensions;
}

const Config = type({
	name: "/^[a-z0-9-]{3,255}$/",
	client_id: type.keywords.string.uuid.v4,
	description: type.string.optional(),
	version: type.keywords.string.semver,
	url: type.keywords.string.url.root,
	proxy_url: type.keywords.string.url.root,
	authorization_scopes: type.string.array().moreThanLength(0),
	subscriptions: SubscriptionsType.optional(),
	actions: ActionConfig.array().optional(),
	dependencies: DependenciesType.array().optional(),
	extensions: ExtensionsType.optional(),
});

export type Config = typeof Config.infer;
export type ConfigEnvironment = Environment | "dev" | "test";

function isConfigValidationErrors(
	value: Config | ArkErrors,
): value is ArkErrors {
	return value instanceof type.errors;
}

function toConfigError(
	error: unknown,
	fallbackMessage: string,
): ConfigurationError {
	if (error instanceof ConfigurationError) {
		return error;
	}

	if (error instanceof Error) {
		return new ConfigurationError({
			message: error.message,
			userMessage: fallbackMessage,
		});
	}

	return new ConfigurationError({
		message: fallbackMessage,
		userMessage: fallbackMessage,
	});
}

function resolveConfigEnvironment(
	env?: ConfigEnvironment,
): ConfigEnvironment | undefined {
	if (!env) {
		return undefined;
	}

	const apiOverrideCandidates = [
		process.env.APPLICATIONS_GRAPHQL_URL,
		process.env.GODADDY_API_BASE_URL,
	].filter((value): value is string => Boolean(value?.trim()));

	for (const candidate of apiOverrideCandidates) {
		const normalizedCandidate = candidate.toLowerCase();

		if (normalizedCandidate.includes("dev-godaddy")) {
			return "dev";
		}

		if (normalizedCandidate.includes("test-godaddy")) {
			return "test";
		}
	}

	return env;
}

/**
 * Get the configuration file path based on environment
 * @param env Optional environment to get config for
 * @param configPath Optional specific config path
 * @returns The resolved path to the config file
 */
export function getConfigFilePath(
	env?: ConfigEnvironment,
	configPath?: string,
): string {
	if (configPath) {
		return join(process.cwd(), configPath);
	}

	const resolvedEnv = resolveConfigEnvironment(env);
	const fileName = resolvedEnv ? `godaddy.${resolvedEnv}.toml` : "godaddy.toml";
	return join(process.cwd(), fileName);
}

export function getConfigFile(
	{
		configPath,
		env,
	}: {
		configPath?: string;
		env?: ConfigEnvironment;
	} = {},
	fs?: FileSystemService,
): Config | ArkErrors {
	const resolvedEnv = resolveConfigEnvironment(env);
	const _fs = fs ?? requireNodeFs();

	// If a specific config path is provided, use that
	if (configPath) {
		const absolutePath = join(process.cwd(), configPath);

		if (_fs.existsSync(absolutePath)) {
			const content = _fs.readFileSync(absolutePath, "utf-8");
			return Config(TOML.parse(content));
		}

		throw new Error(`Config file not found at ${absolutePath}`);
	}

	// If no specific path is provided, try environment-specific file first
	if (resolvedEnv) {
		const envFilePath = getConfigFilePath(resolvedEnv);

		if (_fs.existsSync(envFilePath)) {
			const content = _fs.readFileSync(envFilePath, "utf-8");
			return Config(TOML.parse(content));
		}

		// Fallback to the default file without logging to stdout/stderr.
	}

	// Fall back to default config file
	const defaultPath = getConfigFilePath();
	if (_fs.existsSync(defaultPath)) {
		const content = _fs.readFileSync(defaultPath, "utf-8");
		return Config(TOML.parse(content));
	}

	const envHint =
		resolvedEnv && resolvedEnv !== "prod"
			? ` Consider running 'godaddy application init' to create environment-specific configs.`
			: "";
	throw new Error(`Config file not found at ${defaultPath}.${envHint}`);
}

/**
 * Fallback: lazily load node:fs for call sites that don't pass a FileSystemService.
 * This is only used during the transition — callers should pass fs explicitly.
 */
function requireNodeFs(): FileSystemService {
	// biome-ignore lint/style/noNamespaceImport: fallback only
	const nodeFs = require("node:fs") as typeof import("node:fs");
	return {
		readFileSync: (path: string, encoding: BufferEncoding) =>
			nodeFs.readFileSync(path, encoding),
		writeFileSync: (path: string, data: string | NodeJS.ArrayBufferView) =>
			nodeFs.writeFileSync(path, data),
		existsSync: (path: string) => nodeFs.existsSync(path),
		mkdirSync: (path: string, options?: Parameters<typeof nodeFs.mkdirSync>[1]) =>
			nodeFs.mkdirSync(path, options),
		mkdtempSync: (prefix: string) => nodeFs.mkdtempSync(prefix),
		readdirSync: ((path: string, options?: unknown) =>
			options
				? nodeFs.readdirSync(path, options as Parameters<typeof nodeFs.readdirSync>[1])
				: nodeFs.readdirSync(path)) as FileSystemService["readdirSync"],
		statSync: (path: string) => nodeFs.statSync(path),
		rmSync: (path: string, options?: Parameters<typeof nodeFs.rmSync>[1]) =>
			nodeFs.rmSync(path, options),
	};
}

/**
 * Determine which config file path to use for updates
 * Priority: explicit configPath > env-specific file > default file
 */
function getConfigFilePathForUpdate(
	configPath?: string,
	env?: ConfigEnvironment,
	fs?: FileSystemService,
): { path: string; env?: ConfigEnvironment } {
	const resolvedEnv = resolveConfigEnvironment(env);
	const _fs = fs ?? requireNodeFs();

	// If a specific config path is provided, use that
	if (configPath) {
		const absolutePath = join(process.cwd(), configPath);
		if (_fs.existsSync(absolutePath)) {
			return { path: absolutePath };
		}
		throw new Error(`Config file not found at ${absolutePath}`);
	}

	// If env is provided, try environment-specific file first
	if (resolvedEnv) {
		const envFilePath = getConfigFilePath(resolvedEnv);
		if (_fs.existsSync(envFilePath)) {
			return { path: envFilePath, env: resolvedEnv };
		}
	}

	// Fall back to default config file
	const defaultPath = getConfigFilePath();
	if (_fs.existsSync(defaultPath)) {
		return { path: defaultPath };
	}

	// If no file exists, create environment-specific file if env is provided
	if (resolvedEnv) {
		return { path: getConfigFilePath(resolvedEnv), env: resolvedEnv };
	}

	return { path: defaultPath };
}

/**
 * Write the config data to the appropriate TOML file.
 * Preserves existing config structure where possible.
 */
export function createConfigFileEffect(
	data: Config,
	env?: ConfigEnvironment,
): Effect.Effect<void, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		writeConfigToFile(data, env, fs);
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(toConfigError(error, "Failed to create config file")),
		),
	);
}

/**
 * Update the version number in the config file.
 */
export function updateVersionNumberEffect(
	version: string | null,
): Effect.Effect<void, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		if (!version) return;

		const fs = yield* FileSystem;
		const config = getConfigFile({}, fs);
		if (isConfigValidationErrors(config)) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: "Config file validation failed",
					userMessage: config.summary,
				}),
			);
		}
		const newConfig = { ...config, version };
		yield* createConfigFileEffect(newConfig);
	});
}

/**
 * Add an action to the config file.
 */
export function addActionToConfigEffect(
	action: ActionConfig,
	options: { configPath?: string; env?: Environment } = {},
): Effect.Effect<void, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const configResult = getConfigFile(options, fs);
		if (isConfigValidationErrors(configResult)) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: "Config file validation failed",
					userMessage: configResult.summary,
				}),
			);
		}

		const updatedConfig: Config = {
			...configResult,
			actions: [...(configResult.actions || []), action],
		};

		const { env } = getConfigFilePathForUpdate(
			options.configPath,
			options.env,
			fs,
		);
		writeConfigToFile(updatedConfig, env, fs);
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(toConfigError(error, "Unable to update actions in config")),
		),
	);
}

/**
 * Add a subscription to the config file.
 */
export function addSubscriptionToConfigEffect(
	subscription: SubscriptionConfig,
	options: { configPath?: string; env?: Environment } = {},
): Effect.Effect<void, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const configResult = getConfigFile(options, fs);
		if (isConfigValidationErrors(configResult)) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: "Config file validation failed",
					userMessage: configResult.summary,
				}),
			);
		}

		const updatedConfig: Config = {
			...configResult,
			subscriptions: {
				webhook: [
					...(configResult.subscriptions?.webhook || []),
					subscription,
				],
			},
		};

		const { env } = getConfigFilePathForUpdate(
			options.configPath,
			options.env,
			fs,
		);
		writeConfigToFile(updatedConfig, env, fs);
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(toConfigError(error, "Unable to update subscriptions in config")),
		),
	);
}

/**
 * Create a .env file with application secrets.
 */
export function createEnvFileEffect(
	{
		secret,
		publicKey,
		clientId,
		clientSecret,
	}: {
		secret: string;
		publicKey: string;
		clientId: string;
		clientSecret: string;
	},
	env?: ConfigEnvironment,
): Effect.Effect<void, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const resolvedEnv = resolveConfigEnvironment(env);
		const envFileName = resolvedEnv ? `.env.${resolvedEnv}` : ".env";
		const envPath = join(process.cwd(), envFileName);

		let envContent = "";
		try {
			if (fs.existsSync(envPath)) {
				const existingEnvContent = fs.readFileSync(envPath, "utf-8");

				// Parse existing .env file
				const envLines = existingEnvContent.split("\n");
				const envVars: Record<string, string> = {};

				// Extract existing environment variables
				for (const line of envLines) {
					if (line.trim() && !line.startsWith("#")) {
						const [key, ...valueParts] = line.split("=");
						if (key) {
							envVars[key.trim()] = valueParts.join("=").trim();
						}
					}
				}

				// Update with new values
				envVars.GODADDY_WEBHOOK_SECRET = secret;
				envVars.GODADDY_PUBLIC_KEY = publicKey;
				envVars.GODADDY_CLIENT_ID = clientId;
				envVars.GODADDY_CLIENT_SECRET = clientSecret;

				// Convert back to .env format
				envContent = Object.entries(envVars)
					.map(([key, value]) => `${key}=${value}`)
					.join("\n");

				// Preserve any comments or formatting by appending them if they're not associated with our keys
				for (const line of envLines) {
					if (line.trim() && (line.startsWith("#") || !line.includes("="))) {
						envContent += `\n${line}`;
					}
				}
			} else {
				// File doesn't exist, create new .env content
				envContent = `GODADDY_WEBHOOK_SECRET=${secret}\nGODADDY_PUBLIC_KEY=${publicKey}\nGODADDY_CLIENT_ID=${clientId}\nGODADDY_CLIENT_SECRET=${clientSecret}`;
			}
		} catch {
			// Error reading file, create new .env content
			envContent = `GODADDY_WEBHOOK_SECRET=${secret}\nGODADDY_PUBLIC_KEY=${publicKey}\nGODADDY_CLIENT_ID=${clientId}\nGODADDY_CLIENT_SECRET=${clientSecret}`;
		}

		fs.writeFileSync(envPath, envContent);
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(toConfigError(error, "Failed to create .env file")),
		),
	);
}

/**
 * Add an extension to the config file.
 */
export function addExtensionToConfigEffect(
	extensionType: ExtensionType,
	extension:
		| EmbedExtensionConfig
		| CheckoutExtensionConfig
		| BlocksExtensionConfig,
	options: { configPath?: string; env?: Environment } = {},
): Effect.Effect<void, ConfigurationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const configResult = getConfigFile(options, fs);
		if (isConfigValidationErrors(configResult)) {
			return yield* Effect.fail(
				new ConfigurationError({
					message: "Config file validation failed",
					userMessage: configResult.summary,
				}),
			);
		}

		const currentExtensions = configResult.extensions || {};
		let updatedExtensions: ExtensionsType;

		if (extensionType === "blocks") {
			updatedExtensions = {
				...currentExtensions,
				blocks: extension as BlocksExtensionConfig,
			};
		} else {
			updatedExtensions = {
				...currentExtensions,
				[extensionType]: [
					...((currentExtensions[extensionType] as Array<unknown>) || []),
					extension,
				],
			} as ExtensionsType;
		}

		const updatedConfig = {
			...configResult,
			extensions: updatedExtensions,
		} satisfies Config;

		const { env } = getConfigFilePathForUpdate(
			options.configPath,
			options.env,
			fs,
		);
		writeConfigToFile(updatedConfig, env, fs);
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(toConfigError(error, "Unable to update extensions in config")),
		),
	);
}

/**
 * Internal helper to write a full Config object to the TOML file.
 */
function writeConfigToFile(
	data: Config,
	env?: ConfigEnvironment,
	fs?: FileSystemService,
): void {
	const _fs = fs ?? requireNodeFs();
	const filePath = getConfigFilePath(env);

	// Try to read the existing file to preserve structure
	let existingConfig = {};
	try {
		if (_fs.existsSync(filePath)) {
			const existingContent = _fs.readFileSync(filePath, "utf-8");
			existingConfig = TOML.parse(existingContent);
		}
	} catch {
		// File doesn't exist or can't be parsed, use empty object
	}

	// Convert actions to the proper format
	const formattedActions = data.actions?.map((action) => {
		if (typeof action === "string") {
			return { name: action, url: "" };
		}
		return action;
	});

	const tomlData: Record<string, unknown> = {
		...Object.fromEntries(
			Object.entries(existingConfig as Record<string, unknown>).filter(
				([key]) =>
					![
						"name",
						"client_id",
						"description",
						"version",
						"url",
						"proxy_url",
						"authorization_scopes",
						"actions",
						"subscriptions",
						"default",
					].includes(key),
			),
		),
		name: data.name,
		client_id: data.client_id,
		description: data.description || "",
		version: data.version,
		url: data.url,
		proxy_url: data.proxy_url,
		authorization_scopes: data.authorization_scopes || [],
		actions: formattedActions,
		subscriptions: data.subscriptions,
	};

	if ("default" in existingConfig) {
		tomlData.default = (existingConfig as Record<string, unknown>).default;
	}

	if (data.dependencies) {
		tomlData.dependencies = data.dependencies;
	}

	if (data.extensions) {
		tomlData.extensions = data.extensions;
	}

	const cleanedTomlData = Object.entries(tomlData).reduce(
		(acc, [key, value]) => {
			if (value !== undefined) {
				acc[key] = value as TOML.AnyJson;
			}
			return acc;
		},
		{} as TOML.JsonMap,
	);

	const tomlString = TOML.stringify(cleanedTomlData);
	_fs.writeFileSync(filePath, tomlString);
}
