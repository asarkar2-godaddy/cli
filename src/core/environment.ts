import * as fs from "node:fs";
import * as Effect from "effect/Effect";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ArkErrors } from "arktype";
import {
	type Config,
	getConfigFile,
	getConfigFilePath,
} from "../services/config";
import {
	type CmdResult,
	ConfigurationError,
	ValidationError,
} from "../shared/types";

export type Environment = "ote" | "prod";

export interface EnvironmentDisplay {
	color: string;
	label: string;
}

export interface EnvironmentInfo {
	environment: Environment;
	display: EnvironmentDisplay;
	configFile?: string;
	config?: Config;
}

const ENV_FILE = ".gdenv";
const ENV_PATH = join(homedir(), ENV_FILE);
const ALL_ENVIRONMENTS: Environment[] = ["ote", "prod"];
let runtimeEnvironmentOverride: Environment | null = null;

function isConfigValidationErrorResult(
	value: ReturnType<typeof getConfigFile>,
): value is ArkErrors {
	return typeof value === "object" && value !== null && "summary" in value;
}

/**
 * Set an in-memory environment override for the current process.
 * This is used by global CLI flags (e.g. --env) without mutating persisted config.
 */
export function setRuntimeEnvironmentOverride(env: Environment | null): void {
	runtimeEnvironmentOverride = env;
}

/**
 * Get all available environments
 */
async function envListPromise(): Promise<CmdResult<Environment[]>> {
	try {
		const activeEnv = await getActiveEnvironmentInternal();
		// Return environments with active one first
		const sorted = [
			activeEnv,
			...ALL_ENVIRONMENTS.filter((e) => e !== activeEnv),
		];
		return { success: true, data: sorted };
	} catch (error) {
		return {
			success: false,
			error: new ConfigurationError(
				`Failed to get environment list: ${error}`,
				"Could not retrieve environment list",
			),
		};
	}
}

/**
 * Get current active environment or specific environment info
 */
async function envGetPromise(
	name?: string,
): Promise<CmdResult<Environment | Environment[]>> {
	try {
		if (name) {
			const validEnv = validateEnvironment(name);
			return { success: true, data: validEnv };
		}

		const activeEnv = await getActiveEnvironmentInternal();
		return { success: true, data: activeEnv };
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof ValidationError
					? error
					: new ConfigurationError(
							`Failed to get environment: ${error}`,
							"Could not retrieve environment information",
						),
		};
	}
}

/**
 * Set active environment
 */
async function envSetPromise(name: string): Promise<CmdResult<void>> {
	try {
		const validEnv = validateEnvironment(name);
		fs.writeFileSync(ENV_PATH, validEnv);
		return { success: true };
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof ValidationError
					? error
					: new ConfigurationError(
							`Failed to set environment: ${error}`,
							"Could not set active environment",
						),
		};
	}
}

/**
 * Get detailed environment information
 */
async function envInfoPromise(
	name?: string,
): Promise<CmdResult<EnvironmentInfo>> {
	try {
		const env = name
			? validateEnvironment(name)
			: await getActiveEnvironmentInternal();
		const display = getEnvironmentDisplay(env);
		const configFilePath = getConfigFilePath(env);

		let config: Config | undefined;
		try {
			const configResult = getConfigFile({ env });
			if (!isConfigValidationErrorResult(configResult)) {
				config = configResult;
			}
		} catch {
			// Config file doesn't exist, which is fine
		}

		return {
			success: true,
			data: {
				environment: env,
				display,
				configFile: configFilePath,
				config,
			},
		};
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof ValidationError
					? error
					: new ConfigurationError(
							`Failed to get environment info: ${error}`,
							"Could not retrieve environment information",
						),
		};
	}
}

/**
 * Get the current active environment (internal helper)
 */
async function getActiveEnvironmentInternal(): Promise<Environment> {
	if (runtimeEnvironmentOverride) {
		return runtimeEnvironmentOverride;
	}

	try {
		if (fs.existsSync(ENV_PATH)) {
			const file = fs.readFileSync(ENV_PATH, "utf-8");
			const env = file.trim();
			return validateEnvironment(env);
		}
		return "ote";
	} catch (error) {
		return "ote";
	}
}

/**
 * Validate that the provided string is a valid environment
 */
export function validateEnvironment(env: string): Environment {
	const normalizedEnv = env.toLowerCase().trim();

	if (ALL_ENVIRONMENTS.includes(normalizedEnv as Environment)) {
		return normalizedEnv as Environment;
	}

	throw new ValidationError(
		`Invalid environment: ${env}. Must be one of: ${ALL_ENVIRONMENTS.join(", ")}`,
		`Invalid environment: ${env}. Must be one of: ${ALL_ENVIRONMENTS.join(", ")}`,
	);
}

/**
 * Get the display properties for an environment
 */
export function getEnvironmentDisplay(env: Environment): EnvironmentDisplay {
	const displays: Record<Environment, EnvironmentDisplay> = {
		ote: { color: "blue", label: "OTE" },
		prod: { color: "red", label: "PROD" },
	};

	return displays[env] || displays.ote;
}

/**
 * Generate the API URL for the given environment.
 * Can be overridden with GODADDY_API_BASE_URL environment variable.
 */
export function getApiUrl(env: Environment): string {
	if (process.env.GODADDY_API_BASE_URL) {
		return process.env.GODADDY_API_BASE_URL;
	}

	if (env === "prod") {
		return "https://api.godaddy.com";
	}
	return "https://api.ote-godaddy.com";
}

/**
 * Get the OAuth Client ID for the given environment.
 * Can be overridden with GODADDY_OAUTH_CLIENT_ID environment variable.
 */
export function getClientId(env: Environment): string {
	if (process.env.GODADDY_OAUTH_CLIENT_ID) {
		return process.env.GODADDY_OAUTH_CLIENT_ID;
	}

	const clientIds: Record<Environment, string> = {
		ote: "a502484b-d7b1-4509-aa88-08b391a54c28",
		prod: "39489dee-4103-4284-9aab-9f2452142bce",
	};

	return clientIds[env];
}

/**
 * Check if an action requires confirmation in the current environment
 */
export function requiresConfirmation(
	env: Environment,
	action: "deploy" | "release" | "delete" | "update",
): boolean {
	if (env === "prod") {
		return true;
	}

	if (env === "ote" && ["deploy", "release", "delete"].includes(action)) {
		return true;
	}

	return false;
}

export function envListEffect(...args: Parameters<typeof envListPromise>): Effect.Effect<Awaited<ReturnType<typeof envListPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => envListPromise(...args),
		catch: (error) => error,
	});
}

export function envGetEffect(...args: Parameters<typeof envGetPromise>): Effect.Effect<Awaited<ReturnType<typeof envGetPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => envGetPromise(...args),
		catch: (error) => error,
	});
}

export function envSetEffect(...args: Parameters<typeof envSetPromise>): Effect.Effect<Awaited<ReturnType<typeof envSetPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => envSetPromise(...args),
		catch: (error) => error,
	});
}

export function envInfoEffect(...args: Parameters<typeof envInfoPromise>): Effect.Effect<Awaited<ReturnType<typeof envInfoPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => envInfoPromise(...args),
		catch: (error) => error,
	});
}

export function envList(
	...args: Parameters<typeof envListPromise>
): Promise<Awaited<ReturnType<typeof envListPromise>>> {
	return Effect.runPromise(envListEffect(...args));
}

export function envGet(
	...args: Parameters<typeof envGetPromise>
): Promise<Awaited<ReturnType<typeof envGetPromise>>> {
	return Effect.runPromise(envGetEffect(...args));
}

export function envSet(
	...args: Parameters<typeof envSetPromise>
): Promise<Awaited<ReturnType<typeof envSetPromise>>> {
	return Effect.runPromise(envSetEffect(...args));
}

export function envInfo(
	...args: Parameters<typeof envInfoPromise>
): Promise<Awaited<ReturnType<typeof envInfoPromise>>> {
	return Effect.runPromise(envInfoEffect(...args));
}
