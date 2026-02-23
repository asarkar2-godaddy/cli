import { join, resolve } from "node:path";
import type {
	Application,
	ApplicationInfo,
	CreateApplicationInput,
	DeployResult,
	ReleaseInfo,
	ValidationResult,
} from "../../core/applications";
import { type Environment, envGet } from "../../core/environment";
import {
	type ActionConfig,
	type BlocksExtensionConfig,
	type CheckoutExtensionConfig,
	type Config,
	type EmbedExtensionConfig,
	type SubscriptionConfig,
	addActionToConfig,
	addExtensionToConfig,
	addSubscriptionToConfig,
	getConfigFile,
	getConfigFilePath,
} from "../../services/config";
import { ValidationError } from "../../shared/types";
import { mapRuntimeError } from "../agent/errors";
import { nextActionsFor } from "../agent/next-actions";
import {
	commandIds,
	findRegistryNodeById,
	registryNodeToResult,
} from "../agent/registry";
import {
	currentCommandString,
	emitError,
	emitSuccess,
	unwrapResult,
} from "../agent/respond";
import { protectPayload, truncateList } from "../agent/truncation";
import { Command } from "../command-model";

interface AddBaseOptions {
	config?: string;
	environment?: string;
}

interface UpdateOptions {
	label?: string;
	description?: string;
	status?: string;
}

interface StoreToggleOptions {
	storeId: string;
}

interface AddActionOptions extends AddBaseOptions {
	name: string;
	url: string;
}

interface AddSubscriptionOptions extends AddBaseOptions {
	name: string;
	events: string;
	url: string;
}

interface AddExtensionEmbedOptions extends AddBaseOptions {
	name: string;
	handle: string;
	source: string;
	target: string;
}

interface AddExtensionBlocksOptions extends AddBaseOptions {
	source: string;
}

interface InitOptions extends AddBaseOptions {
	name?: string;
	description?: string;
	url?: string;
	proxyUrl?: string;
	scopes?: string[];
}

interface ReleaseOptions extends AddBaseOptions {
	releaseVersion: string;
	description?: string;
}

interface DeployOptions extends AddBaseOptions {}

type ConfigReadResult = ReturnType<typeof getConfigFile>;

async function resolveEnvironment(environment?: string): Promise<Environment> {
	if (environment) {
		return unwrapResult(
			await envGet(environment),
			"Failed to resolve environment",
		) as Environment;
	}

	return unwrapResult(
		await envGet(),
		"Failed to resolve environment",
	) as Environment;
}

function ensureSuccess(
	result: { success: boolean; error?: unknown },
	fallbackMessage: string,
): void {
	if (!result.success) {
		throw result.error instanceof Error
			? result.error
			: new Error(fallbackMessage);
	}
}

function resolveConfigPath(
	configPath: string | undefined,
	env: Environment,
): string {
	if (configPath) {
		return resolve(process.cwd(), configPath);
	}
	return getConfigFilePath(env);
}

function parseSpaceSeparated(value: string): string[] {
	return value
		.split(" ")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function parseCommaSeparated(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function isConfigValidationErrorResult(
	value: ConfigReadResult,
): value is Exclude<ConfigReadResult, Config> {
	return typeof value === "object" && value !== null && "problems" in value;
}

function emitRuntimeError(
	commandId: keyof typeof commandIds,
	error: unknown,
): void {
	const mapped = mapRuntimeError(error);
	emitError(
		currentCommandString(),
		{ message: mapped.message, code: mapped.code },
		mapped.fix,
		nextActionsFor(commandIds[commandId]),
	);
}

async function loadApplicationModule() {
	return import("../../core/applications");
}

export function createApplicationCommand(): Command {
	const app = new Command("application")
		.alias("app")
		.description("Manage applications");

	app.action(async () => {
		const node = findRegistryNodeById(commandIds.applicationGroup);
		if (!node) {
			emitRuntimeError(
				"root",
				new Error("Application command registry metadata is missing"),
			);
			return;
		}

		emitSuccess(
			currentCommandString(),
			registryNodeToResult(node),
			nextActionsFor(commandIds.applicationGroup),
		);
	});

	app
		.command("info")
		.description("Show application information")
		.argument("<name>", "Application name")
		.action(async (name: string) => {
			try {
				const { applicationInfo } = await loadApplicationModule();
				const appInfo = unwrapResult(
					await applicationInfo(name),
					"Failed to get application info",
				) as ApplicationInfo;
				const latestRelease = appInfo.releases?.[0]
					? {
							id: appInfo.releases[0].id,
							version: appInfo.releases[0].version,
							description: appInfo.releases[0].description,
							created_at: appInfo.releases[0].createdAt,
						}
					: null;

				emitSuccess(
					currentCommandString(),
					{
						id: appInfo.id,
						label: appInfo.label,
						name: appInfo.name,
						description: appInfo.description,
						status: appInfo.status,
						url: appInfo.url,
						proxy_url: appInfo.proxyUrl,
						authorization_scopes: appInfo.authorizationScopes ?? [],
						latest_release: latestRelease,
					},
					nextActionsFor(commandIds.applicationInfo, {
						applicationName: name,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	app
		.command("list")
		.alias("ls")
		.description("List all applications")
		.action(async () => {
			try {
				const { applicationList } = await loadApplicationModule();
				const applications = unwrapResult(
					await applicationList(),
					"Failed to list applications",
				) as Application[];

				const truncated = truncateList(applications, "application-list");

				emitSuccess(
					currentCommandString(),
					{
						applications: truncated.items,
						total: truncated.metadata.total,
						shown: truncated.metadata.shown,
						truncated: truncated.metadata.truncated,
						full_output: truncated.metadata.full_output,
					},
					nextActionsFor(commandIds.applicationList),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	app
		.command("validate")
		.description("Validate application configuration")
		.argument("<name>", "Application name")
		.action(async (name: string) => {
			try {
				const { applicationValidate } = await loadApplicationModule();
				const validation = unwrapResult(
					await applicationValidate(name),
					"Failed to validate application",
				) as ValidationResult;

				const protectedPayload = protectPayload(
					{
						valid: validation.valid,
						errors: validation.errors,
						warnings: validation.warnings,
					},
					`application-validate-${name}`,
				);

				emitSuccess(
					currentCommandString(),
					{
						valid: validation.valid,
						error_count: validation.errors.length,
						warning_count: validation.warnings.length,
						details: protectedPayload.value,
						truncated: protectedPayload.metadata?.truncated ?? false,
						total: protectedPayload.metadata?.total,
						shown: protectedPayload.metadata?.shown,
						full_output: protectedPayload.metadata?.full_output,
					},
					nextActionsFor(commandIds.applicationValidate, {
						applicationName: name,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	app
		.command("update")
		.description("Update application configuration")
		.argument("<name>", "Application name")
		.option("--label <label>", "Application label")
		.option("--description <description>", "Application description")
		.option("--status <status>", "Application status (ACTIVE|INACTIVE)")
		.action(async (name: string, options: UpdateOptions) => {
			try {
				const { applicationUpdate } = await loadApplicationModule();
				const config: {
					label?: string;
					description?: string;
					status?: "ACTIVE" | "INACTIVE";
				} = {};

				if (options.label) {
					config.label = options.label;
				}
				if (options.description) {
					config.description = options.description;
				}
				if (options.status) {
					if (options.status !== "ACTIVE" && options.status !== "INACTIVE") {
						throw new ValidationError(
							"Status must be either ACTIVE or INACTIVE",
							"Status must be either ACTIVE or INACTIVE",
						);
					}
					config.status = options.status;
				}

				if (Object.keys(config).length === 0) {
					throw new ValidationError(
						"At least one field must be specified for update",
						"Provide one of: --label, --description, --status",
					);
				}

				ensureSuccess(
					await applicationUpdate(name, config),
					"Failed to update application",
				);

				emitSuccess(
					currentCommandString(),
					{
						name,
						updated_fields: Object.keys(config),
						status: config.status,
					},
					nextActionsFor(commandIds.applicationUpdate, {
						applicationName: name,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	app
		.command("enable")
		.description("Enable application on a store")
		.argument("<name>", "Application name")
		.requiredOption("--store-id <storeId>", "Store ID")
		.action(async (name: string, options: StoreToggleOptions) => {
			try {
				const { applicationEnable } = await loadApplicationModule();
				ensureSuccess(
					await applicationEnable(name, options.storeId),
					"Failed to enable application",
				);

				emitSuccess(
					currentCommandString(),
					{ name, store_id: options.storeId, enabled: true },
					nextActionsFor(commandIds.applicationEnable, {
						applicationName: name,
						storeId: options.storeId,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	app
		.command("disable")
		.description("Disable application on a store")
		.argument("<name>", "Application name")
		.requiredOption("--store-id <storeId>", "Store ID")
		.action(async (name: string, options: StoreToggleOptions) => {
			try {
				const { applicationDisable } = await loadApplicationModule();
				ensureSuccess(
					await applicationDisable(name, options.storeId),
					"Failed to disable application",
				);

				emitSuccess(
					currentCommandString(),
					{ name, store_id: options.storeId, enabled: false },
					nextActionsFor(commandIds.applicationDisable, {
						applicationName: name,
						storeId: options.storeId,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	app
		.command("archive")
		.description("Archive application")
		.argument("<name>", "Application name")
		.action(async (name: string) => {
			try {
				const { applicationArchive } = await loadApplicationModule();
				ensureSuccess(
					await applicationArchive(name),
					"Failed to archive application",
				);
				emitSuccess(
					currentCommandString(),
					{ name, archived: true },
					nextActionsFor(commandIds.applicationArchive, {
						applicationName: name,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	app
		.command("init")
		.description("Initialize/create a new application")
		.option("--name <name>", "Application name")
		.option("--description <description>", "Application description")
		.option("--url <url>", "Application URL")
		.option("--proxy-url <proxyUrl>", "Proxy URL for API endpoints")
		.option(
			"--scopes <scopes>",
			"Authorization scopes (space-separated)",
			parseSpaceSeparated,
		)
		.option("-c, --config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action(async (options: InitOptions) => {
			try {
				const { applicationInit } = await loadApplicationModule();
				let cfg: Config | undefined;
				if (options.config || options.environment) {
					const candidate = getConfigFile({
						configPath: options.config,
						env: options.environment as Environment | undefined,
					});
					if (isConfigValidationErrorResult(candidate)) {
						const problems = Array.isArray(candidate.problems)
							? candidate.problems
									.map(
										(problem: { summary?: string }) =>
											problem.summary ?? "Unknown validation problem",
									)
									.join("; ")
							: "Config file validation failed";
						throw new ValidationError(problems, problems);
					}
					cfg = candidate;
				}

				const input: CreateApplicationInput = {
					name: options.name ?? cfg?.name ?? "",
					description: options.description ?? cfg?.description ?? "",
					url: options.url ?? cfg?.url ?? "",
					proxyUrl: options.proxyUrl ?? cfg?.proxy_url ?? "",
					authorizationScopes:
						options.scopes ?? cfg?.authorization_scopes ?? [],
				};

				if (!input.name) {
					throw new ValidationError(
						"Application name is required",
						"Application name is required",
					);
				}
				if (!input.description) {
					throw new ValidationError(
						"Application description is required",
						"Application description is required",
					);
				}
				if (!input.url) {
					throw new ValidationError(
						"Application URL is required",
						"Application URL is required",
					);
				}
				if (!input.proxyUrl) {
					throw new ValidationError(
						"Proxy URL is required",
						"Proxy URL is required",
					);
				}
				if (!input.authorizationScopes.length) {
					throw new ValidationError(
						"Authorization scopes are required",
						"Authorization scopes are required",
					);
				}

				const environment = await resolveEnvironment(options.environment);
				const appData = unwrapResult(
					await applicationInit(input, environment),
					"Failed to create application",
				);

				emitSuccess(
					currentCommandString(),
					{
						id: appData.id,
						name: appData.name,
						status: appData.status,
						url: appData.url,
						proxy_url: appData.proxyUrl,
						authorization_scopes: appData.authorizationScopes,
						client_id: appData.clientId,
						files_written: {
							config: getConfigFilePath(environment),
							env: join(process.cwd(), `.env.${environment}`),
						},
					},
					nextActionsFor(commandIds.applicationInit, {
						applicationName: appData.name,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	const addCommand = new Command("add").description(
		"Add configurations to application",
	);

	addCommand.action(async () => {
		const node = findRegistryNodeById(commandIds.applicationAddGroup);
		if (!node) {
			emitRuntimeError(
				"applicationGroup",
				new Error("Application add registry metadata is missing"),
			);
			return;
		}

		emitSuccess(
			currentCommandString(),
			registryNodeToResult(node),
			nextActionsFor(commandIds.applicationAddGroup),
		);
	});

	addCommand
		.command("action")
		.description("Add action configuration to godaddy.toml")
		.requiredOption("--name <name>", "Action name")
		.requiredOption("--url <url>", "Action endpoint URL")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action(async (options: AddActionOptions) => {
			try {
				if (options.name.length < 3) {
					throw new ValidationError(
						"Action name must be at least 3 characters long",
						"Action name must be at least 3 characters long",
					);
				}

				const environment = await resolveEnvironment(options.environment);
				const action: ActionConfig = { name: options.name, url: options.url };
				ensureSuccess(
					await addActionToConfig(action, {
						configPath: options.config,
						env: environment,
					}),
					"Failed to add action",
				);

				emitSuccess(
					currentCommandString(),
					{
						action,
						config_path: resolveConfigPath(options.config, environment),
					},
					nextActionsFor(commandIds.applicationAddAction),
				);
			} catch (error) {
				emitRuntimeError("applicationAddGroup", error);
			}
		});

	addCommand
		.command("subscription")
		.description("Add webhook subscription configuration to godaddy.toml")
		.requiredOption("--name <name>", "Subscription name")
		.requiredOption("--events <events>", "Comma-separated list of events")
		.requiredOption("--url <url>", "Webhook endpoint URL")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action(async (options: AddSubscriptionOptions) => {
			try {
				if (options.name.length < 3) {
					throw new ValidationError(
						"Subscription name must be at least 3 characters long",
						"Subscription name must be at least 3 characters long",
					);
				}

				const eventList = parseCommaSeparated(options.events);
				if (!eventList.length) {
					throw new ValidationError(
						"At least one event is required",
						"At least one event is required",
					);
				}

				const environment = await resolveEnvironment(options.environment);
				const subscription: SubscriptionConfig = {
					name: options.name,
					events: eventList,
					url: options.url,
				};
				ensureSuccess(
					await addSubscriptionToConfig(subscription, {
						configPath: options.config,
						env: environment,
					}),
					"Failed to add subscription",
				);

				emitSuccess(
					currentCommandString(),
					{
						subscription,
						config_path: resolveConfigPath(options.config, environment),
					},
					nextActionsFor(commandIds.applicationAddSubscription),
				);
			} catch (error) {
				emitRuntimeError("applicationAddGroup", error);
			}
		});

	const extensionCommand = addCommand
		.command("extension")
		.description("Add UI extension configuration to godaddy.toml");

	extensionCommand.action(async () => {
		const node = findRegistryNodeById(commandIds.applicationAddExtensionGroup);
		if (!node) {
			emitRuntimeError(
				"applicationAddGroup",
				new Error("Application add extension registry metadata is missing"),
			);
			return;
		}

		emitSuccess(
			currentCommandString(),
			registryNodeToResult(node),
			nextActionsFor(commandIds.applicationAddExtensionGroup),
		);
	});

	extensionCommand
		.command("embed")
		.description("Add an embed extension")
		.requiredOption("--name <name>", "Extension name")
		.requiredOption("--handle <handle>", "Extension handle")
		.requiredOption("--source <source>", "Path to extension source file")
		.requiredOption(
			"--target <targets>",
			"Comma-separated list of target locations",
		)
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action(async (options: AddExtensionEmbedOptions) => {
			try {
				if (options.name.length < 3) {
					throw new ValidationError(
						"Extension name must be at least 3 characters long",
						"Extension name must be at least 3 characters long",
					);
				}
				if (options.handle.length < 3) {
					throw new ValidationError(
						"Extension handle must be at least 3 characters long",
						"Extension handle must be at least 3 characters long",
					);
				}

				const targets = parseCommaSeparated(options.target).map((target) => ({
					target,
				}));
				if (!targets.length) {
					throw new ValidationError(
						"At least one valid target is required",
						"At least one valid target is required",
					);
				}

				const extension: EmbedExtensionConfig = {
					name: options.name,
					handle: options.handle,
					source: options.source,
					targets,
				};
				const environment = await resolveEnvironment(options.environment);
				ensureSuccess(
					await addExtensionToConfig("embed", extension, {
						configPath: options.config,
						env: environment,
					}),
					"Failed to add extension",
				);

				emitSuccess(
					currentCommandString(),
					{
						extension_type: "embed",
						extension,
						config_path: resolveConfigPath(options.config, environment),
					},
					nextActionsFor(commandIds.applicationAddExtensionEmbed),
				);
			} catch (error) {
				emitRuntimeError("applicationAddExtensionGroup", error);
			}
		});

	extensionCommand
		.command("checkout")
		.description("Add a checkout extension")
		.requiredOption("--name <name>", "Extension name")
		.requiredOption("--handle <handle>", "Extension handle")
		.requiredOption("--source <source>", "Path to extension source file")
		.requiredOption(
			"--target <targets>",
			"Comma-separated list of checkout target locations",
		)
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action(async (options: AddExtensionEmbedOptions) => {
			try {
				if (options.name.length < 3) {
					throw new ValidationError(
						"Extension name must be at least 3 characters long",
						"Extension name must be at least 3 characters long",
					);
				}
				if (options.handle.length < 3) {
					throw new ValidationError(
						"Extension handle must be at least 3 characters long",
						"Extension handle must be at least 3 characters long",
					);
				}

				const targets = parseCommaSeparated(options.target).map((target) => ({
					target,
				}));
				if (!targets.length) {
					throw new ValidationError(
						"At least one valid target is required",
						"At least one valid target is required",
					);
				}

				const extension: CheckoutExtensionConfig = {
					name: options.name,
					handle: options.handle,
					source: options.source,
					targets,
				};
				const environment = await resolveEnvironment(options.environment);
				ensureSuccess(
					await addExtensionToConfig("checkout", extension, {
						configPath: options.config,
						env: environment,
					}),
					"Failed to add extension",
				);

				emitSuccess(
					currentCommandString(),
					{
						extension_type: "checkout",
						extension,
						config_path: resolveConfigPath(options.config, environment),
					},
					nextActionsFor(commandIds.applicationAddExtensionCheckout),
				);
			} catch (error) {
				emitRuntimeError("applicationAddExtensionGroup", error);
			}
		});

	extensionCommand
		.command("blocks")
		.description("Set the blocks extension source")
		.requiredOption("--source <source>", "Path to blocks extension source file")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action(async (options: AddExtensionBlocksOptions) => {
			try {
				const extension: BlocksExtensionConfig = {
					source: options.source,
				};
				const environment = await resolveEnvironment(options.environment);
				ensureSuccess(
					await addExtensionToConfig("blocks", extension, {
						configPath: options.config,
						env: environment,
					}),
					"Failed to add extension",
				);

				emitSuccess(
					currentCommandString(),
					{
						extension_type: "blocks",
						extension,
						config_path: resolveConfigPath(options.config, environment),
					},
					nextActionsFor(commandIds.applicationAddExtensionBlocks),
				);
			} catch (error) {
				emitRuntimeError("applicationAddExtensionGroup", error);
			}
		});

	app.addCommand(addCommand);

	app
		.command("release")
		.description("Create a new release for the application")
		.argument("<name>", "Application name")
		.requiredOption("--release-version <version>", "Release version")
		.option("--description <description>", "Release description")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action(async (name: string, options: ReleaseOptions) => {
			try {
				const { applicationRelease } = await loadApplicationModule();
				const environment = await resolveEnvironment(options.environment);
				const releaseInfo = unwrapResult(
					await applicationRelease({
						applicationName: name,
						version: options.releaseVersion,
						description: options.description,
						configPath: options.config,
						env: environment,
					}),
					"Failed to create release",
				) as ReleaseInfo;

				emitSuccess(
					currentCommandString(),
					{
						id: releaseInfo.id,
						version: releaseInfo.version,
						description: releaseInfo.description,
						created_at: releaseInfo.createdAt,
					},
					nextActionsFor(commandIds.applicationRelease, {
						applicationName: name,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	app
		.command("deploy")
		.description("Deploy application (change status to ACTIVE)")
		.argument("<name>", "Application name")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action(async (name: string, options: DeployOptions) => {
			try {
				const { applicationDeploy } = await loadApplicationModule();
				const environment = await resolveEnvironment(options.environment);
				const deployResult = unwrapResult(
					await applicationDeploy(name, {
						configPath: options.config,
						env: environment,
					}),
					"Failed to deploy application",
				) as DeployResult;

				const summarizedPayload = protectPayload(
					{
						total_extensions: deployResult.totalExtensions,
						blocked_extensions: deployResult.blockedExtensions,
						security_reports: deployResult.securityReports,
						bundle_reports: deployResult.bundleReports.map((report) => ({
							extension_name: report.extensionName,
							artifact_name: report.artifactName,
							size_bytes: report.size,
							targets: report.targets,
							uploaded: report.uploaded,
						})),
					},
					`application-deploy-${name}`,
				);

				emitSuccess(
					currentCommandString(),
					{
						...summarizedPayload.value,
						truncated: summarizedPayload.metadata?.truncated ?? false,
						total: summarizedPayload.metadata?.total,
						shown: summarizedPayload.metadata?.shown,
						full_output: summarizedPayload.metadata?.full_output,
					},
					nextActionsFor(commandIds.applicationDeploy, {
						applicationName: name,
					}),
				);
			} catch (error) {
				emitRuntimeError("applicationGroup", error);
			}
		});

	return app;
}
