import { join, resolve } from "node:path";
import type { ArkErrors } from "arktype";
import * as Effect from "effect/Effect";
import type {
	CreateApplicationInput,
	DeployProgressEvent,
	DeployResult,
} from "../../core/applications";
import {
	applicationArchiveEffect,
	applicationDeployEffect,
	applicationDisableEffect,
	applicationEnableEffect,
	applicationInfoEffect,
	applicationInitEffect,
	applicationListEffect,
	applicationReleaseEffect,
	applicationUpdateEffect,
	applicationValidateEffect,
} from "../../core/applications";
import { type Environment, envGetEffect } from "../../core/environment";
import { ValidationError } from "../../effect/errors";
import {
	type ActionConfig,
	type BlocksExtensionConfig,
	type CheckoutExtensionConfig,
	type Config,
	type EmbedExtensionConfig,
	type SubscriptionConfig,
	addActionToConfigEffect,
	addExtensionToConfigEffect,
	addSubscriptionToConfigEffect,
	getConfigFile,
	getConfigFilePath,
} from "../../services/config";
import { mapRuntimeError } from "../agent/errors";
import { nextActionsFor } from "../agent/next-actions";
import {
	commandIds,
	findRegistryNodeById,
	registryNodeToResult,
} from "../agent/registry";
import { currentCommandString, emitError, emitSuccess } from "../agent/respond";
import {
	emitStreamError,
	emitStreamProgress,
	emitStreamResult,
	emitStreamStart,
	emitStreamStep,
} from "../agent/stream";
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

interface DeployOptions extends AddBaseOptions {
	follow?: boolean;
}

type ConfigReadResult = ReturnType<typeof getConfigFile>;

function resolveEnvironmentEffect(environment?: string) {
	return envGetEffect(environment);
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
): value is ArkErrors {
	return typeof value === "object" && value !== null && "summary" in value;
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

function runApplicationCommand<R>(
	commandId: keyof typeof commandIds,
	effect: Effect.Effect<void, unknown, R>,
): Effect.Effect<void, never, R> {
	return effect.pipe(
		Effect.catchAll((error) =>
			Effect.sync(() => {
				emitRuntimeError(commandId, error);
			}),
		),
	);
}

function buildDeployPayload(
	name: string,
	deployResult: DeployResult,
): Record<string, unknown> {
	const summarizedPayload = protectPayload(
		{
			total_extensions: deployResult.totalExtensions,
			blocked_extensions: deployResult.blockedExtensions,
			security_reports: deployResult.securityReports.map((report) => ({
				extension_name: report.extensionName,
				extension_dir: report.extensionDir,
				blocked: report.blocked,
				total_findings: report.totalFindings,
				blocked_findings: report.blockedFindings,
				warnings: report.warnings,
				pre_bundle: {
					blocked: report.preBundleReport.blocked,
					scanned_files: report.preBundleReport.scannedFiles,
					summary: report.preBundleReport.summary,
					findings: report.preBundleReport.findings,
				},
				post_bundle: report.postBundleReport
					? {
							blocked: report.postBundleReport.blocked,
							scanned_files: report.postBundleReport.scannedFiles,
							summary: report.postBundleReport.summary,
							findings: report.postBundleReport.findings,
						}
					: undefined,
			})),
			bundle_reports: deployResult.bundleReports.map((report) => ({
				extension_name: report.extensionName,
				artifact_name: report.artifactName,
				size_bytes: report.size,
				sha256: report.sha256,
				targets: report.targets,
				upload_ids: report.uploadIds,
				uploaded: report.uploaded,
			})),
		},
		`application-deploy-${name}`,
	);

	return {
		...summarizedPayload.value,
		truncated: summarizedPayload.metadata?.truncated ?? false,
		total: summarizedPayload.metadata?.total,
		shown: summarizedPayload.metadata?.shown,
		full_output: summarizedPayload.metadata?.full_output,
	};
}

function emitDeployProgressAsStream(event: DeployProgressEvent): void {
	if (event.type === "step") {
		if (!event.status) {
			return;
		}

		emitStreamStep({
			name: event.name,
			status: event.status,
			message: event.message,
			extensionName: event.extensionName,
			details: event.details,
		});
		return;
	}

	if (event.type === "progress") {
		emitStreamProgress({
			name: event.name,
			percent: event.percent,
			message: event.message,
			details: event.details,
		});
	}
}

export function createApplicationCommand(): Command {
	const app = new Command("application")
		.alias("app")
		.description("Manage applications");

	app.action(() =>
		Effect.sync(() => {
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
		}),
	);

	app
		.command("info")
		.description("Show application information")
		.argument("<name>", "Application name")
		.action((name: string) =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
					const appInfo = yield* applicationInfoEffect(name);
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
				}),
			),
		);

	app
		.command("list")
		.alias("ls")
		.description("List all applications")
		.action(() =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
					const applications = yield* applicationListEffect();

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
				}),
			),
		);

	app
		.command("validate")
		.description("Validate application configuration")
		.argument("<name>", "Application name")
		.action((name: string) =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
					const validation = yield* applicationValidateEffect(name);

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
				}),
			),
		);

	app
		.command("update")
		.description("Update application configuration")
		.argument("<name>", "Application name")
		.option("--label <label>", "Application label")
		.option("--description <description>", "Application description")
		.option("--status <status>", "Application status (ACTIVE|INACTIVE)")
		.action((name: string, options: UpdateOptions) =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
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
							return yield* Effect.fail(
								new ValidationError({
									message: "Status must be either ACTIVE or INACTIVE",
									userMessage: "Status must be either ACTIVE or INACTIVE",
								}),
							);
						}
						config.status = options.status;
					}

					if (Object.keys(config).length === 0) {
						return yield* Effect.fail(
							new ValidationError({
								message: "At least one field must be specified for update",
								userMessage: "Provide one of: --label, --description, --status",
							}),
						);
					}

					yield* applicationUpdateEffect(name, config);

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
				}),
			),
		);

	app
		.command("enable")
		.description("Enable application on a store")
		.argument("<name>", "Application name")
		.requiredOption("--store-id <storeId>", "Store ID")
		.action((name: string, options: StoreToggleOptions) =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
					yield* applicationEnableEffect(name, options.storeId);

					emitSuccess(
						currentCommandString(),
						{ name, store_id: options.storeId, enabled: true },
						nextActionsFor(commandIds.applicationEnable, {
							applicationName: name,
							storeId: options.storeId,
						}),
					);
				}),
			),
		);

	app
		.command("disable")
		.description("Disable application on a store")
		.argument("<name>", "Application name")
		.requiredOption("--store-id <storeId>", "Store ID")
		.action((name: string, options: StoreToggleOptions) =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
					yield* applicationDisableEffect(name, options.storeId);

					emitSuccess(
						currentCommandString(),
						{ name, store_id: options.storeId, enabled: false },
						nextActionsFor(commandIds.applicationDisable, {
							applicationName: name,
							storeId: options.storeId,
						}),
					);
				}),
			),
		);

	app
		.command("archive")
		.description("Archive application")
		.argument("<name>", "Application name")
		.action((name: string) =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
					yield* applicationArchiveEffect(name);
					emitSuccess(
						currentCommandString(),
						{ name, archived: true },
						nextActionsFor(commandIds.applicationArchive, {
							applicationName: name,
						}),
					);
				}),
			),
		);

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
		.action((options: InitOptions) =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
					let cfg: Config | undefined;
					if (options.config || options.environment) {
						const candidate = getConfigFile({
							configPath: options.config,
							env: options.environment as Environment | undefined,
						});
						if (isConfigValidationErrorResult(candidate)) {
							const problems =
								typeof candidate.summary === "string"
									? candidate.summary
									: "Config file validation failed";
							return yield* Effect.fail(
								new ValidationError({
									message: problems,
									userMessage: problems,
								}),
							);
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
						return yield* Effect.fail(
							new ValidationError({
								message: "Application name is required",
								userMessage: "Application name is required",
							}),
						);
					}
					if (!input.description) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Application description is required",
								userMessage: "Application description is required",
							}),
						);
					}
					if (!input.url) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Application URL is required",
								userMessage: "Application URL is required",
							}),
						);
					}
					if (!input.proxyUrl) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Proxy URL is required",
								userMessage: "Proxy URL is required",
							}),
						);
					}
					if (!input.authorizationScopes.length) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Authorization scopes are required",
								userMessage: "Authorization scopes are required",
							}),
						);
					}

					const environment = yield* resolveEnvironmentEffect(
						options.environment,
					);
					const appData = yield* applicationInitEffect(input, environment);

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
				}),
			),
		);

	const addCommand = new Command("add").description(
		"Add configurations to application",
	);

	addCommand.action(() =>
		Effect.sync(() => {
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
		}),
	);

	addCommand
		.command("action")
		.description("Add action configuration to godaddy.toml")
		.requiredOption("--name <name>", "Action name")
		.requiredOption("--url <url>", "Action endpoint URL")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action((options: AddActionOptions) =>
			runApplicationCommand(
				"applicationAddGroup",
				Effect.gen(function* () {
					if (options.name.length < 3) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Action name must be at least 3 characters long",
								userMessage: "Action name must be at least 3 characters long",
							}),
						);
					}

					const environment = yield* resolveEnvironmentEffect(
						options.environment,
					);
					const action: ActionConfig = { name: options.name, url: options.url };
					yield* addActionToConfigEffect(action, {
						configPath: options.config,
						env: environment,
					});

					emitSuccess(
						currentCommandString(),
						{
							action,
							config_path: resolveConfigPath(options.config, environment),
						},
						nextActionsFor(commandIds.applicationAddAction),
					);
				}),
			),
		);

	addCommand
		.command("subscription")
		.description("Add webhook subscription configuration to godaddy.toml")
		.requiredOption("--name <name>", "Subscription name")
		.requiredOption("--events <events>", "Comma-separated list of events")
		.requiredOption("--url <url>", "Webhook endpoint URL")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action((options: AddSubscriptionOptions) =>
			runApplicationCommand(
				"applicationAddGroup",
				Effect.gen(function* () {
					if (options.name.length < 3) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Subscription name must be at least 3 characters long",
								userMessage:
									"Subscription name must be at least 3 characters long",
							}),
						);
					}

					const eventList = parseCommaSeparated(options.events);
					if (!eventList.length) {
						return yield* Effect.fail(
							new ValidationError({
								message: "At least one event is required",
								userMessage: "At least one event is required",
							}),
						);
					}

					const environment = yield* resolveEnvironmentEffect(
						options.environment,
					);
					const subscription: SubscriptionConfig = {
						name: options.name,
						events: eventList,
						url: options.url,
					};
					yield* addSubscriptionToConfigEffect(subscription, {
						configPath: options.config,
						env: environment,
					});

					emitSuccess(
						currentCommandString(),
						{
							subscription,
							config_path: resolveConfigPath(options.config, environment),
						},
						nextActionsFor(commandIds.applicationAddSubscription),
					);
				}),
			),
		);

	const extensionCommand = addCommand
		.command("extension")
		.description("Add UI extension configuration to godaddy.toml");

	extensionCommand.action(() =>
		Effect.sync(() => {
			const node = findRegistryNodeById(
				commandIds.applicationAddExtensionGroup,
			);
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
		}),
	);

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
		.action((options: AddExtensionEmbedOptions) =>
			runApplicationCommand(
				"applicationAddExtensionGroup",
				Effect.gen(function* () {
					if (options.name.length < 3) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Extension name must be at least 3 characters long",
								userMessage:
									"Extension name must be at least 3 characters long",
							}),
						);
					}
					if (options.handle.length < 3) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Extension handle must be at least 3 characters long",
								userMessage:
									"Extension handle must be at least 3 characters long",
							}),
						);
					}

					const targets = parseCommaSeparated(options.target).map((target) => ({
						target,
					}));
					if (!targets.length) {
						return yield* Effect.fail(
							new ValidationError({
								message: "At least one valid target is required",
								userMessage: "At least one valid target is required",
							}),
						);
					}

					const extension: EmbedExtensionConfig = {
						name: options.name,
						handle: options.handle,
						source: options.source,
						targets,
					};
					const environment = yield* resolveEnvironmentEffect(
						options.environment,
					);
					yield* addExtensionToConfigEffect("embed", extension, {
						configPath: options.config,
						env: environment,
					});

					emitSuccess(
						currentCommandString(),
						{
							extension_type: "embed",
							extension,
							config_path: resolveConfigPath(options.config, environment),
						},
						nextActionsFor(commandIds.applicationAddExtensionEmbed),
					);
				}),
			),
		);

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
		.action((options: AddExtensionEmbedOptions) =>
			runApplicationCommand(
				"applicationAddExtensionGroup",
				Effect.gen(function* () {
					if (options.name.length < 3) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Extension name must be at least 3 characters long",
								userMessage:
									"Extension name must be at least 3 characters long",
							}),
						);
					}
					if (options.handle.length < 3) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Extension handle must be at least 3 characters long",
								userMessage:
									"Extension handle must be at least 3 characters long",
							}),
						);
					}

					const targets = parseCommaSeparated(options.target).map((target) => ({
						target,
					}));
					if (!targets.length) {
						return yield* Effect.fail(
							new ValidationError({
								message: "At least one valid target is required",
								userMessage: "At least one valid target is required",
							}),
						);
					}

					const extension: CheckoutExtensionConfig = {
						name: options.name,
						handle: options.handle,
						source: options.source,
						targets,
					};
					const environment = yield* resolveEnvironmentEffect(
						options.environment,
					);
					yield* addExtensionToConfigEffect("checkout", extension, {
						configPath: options.config,
						env: environment,
					});

					emitSuccess(
						currentCommandString(),
						{
							extension_type: "checkout",
							extension,
							config_path: resolveConfigPath(options.config, environment),
						},
						nextActionsFor(commandIds.applicationAddExtensionCheckout),
					);
				}),
			),
		);

	extensionCommand
		.command("blocks")
		.description("Set the blocks extension source")
		.requiredOption("--source <source>", "Path to blocks extension source file")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action((options: AddExtensionBlocksOptions) =>
			runApplicationCommand(
				"applicationAddExtensionGroup",
				Effect.gen(function* () {
					const extension: BlocksExtensionConfig = {
						source: options.source,
					};
					const environment = yield* resolveEnvironmentEffect(
						options.environment,
					);
					yield* addExtensionToConfigEffect("blocks", extension, {
						configPath: options.config,
						env: environment,
					});

					emitSuccess(
						currentCommandString(),
						{
							extension_type: "blocks",
							extension,
							config_path: resolveConfigPath(options.config, environment),
						},
						nextActionsFor(commandIds.applicationAddExtensionBlocks),
					);
				}),
			),
		);

	app.addCommand(addCommand);

	app
		.command("release")
		.description("Create a new release for the application")
		.argument("<name>", "Application name")
		.requiredOption("--release-version <version>", "Release version")
		.option("--description <description>", "Release description")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.action((name: string, options: ReleaseOptions) =>
			runApplicationCommand(
				"applicationGroup",
				Effect.gen(function* () {
					const environment = yield* resolveEnvironmentEffect(
						options.environment,
					);
					const releaseInfo = yield* applicationReleaseEffect({
						applicationName: name,
						version: options.releaseVersion,
						description: options.description,
						configPath: options.config,
						env: environment,
					});

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
				}),
			),
		);

	app
		.command("deploy")
		.description("Deploy application (change status to ACTIVE)")
		.argument("<name>", "Application name")
		.option("--config <path>", "Path to configuration file")
		.option("--environment <env>", "Environment (ote|prod)")
		.option("--follow", "Stream deploy progress as NDJSON events")
		.action((name: string, options: DeployOptions) => {
			const command = currentCommandString();
			const follow = options.follow === true;
			const nextActions = nextActionsFor(commandIds.applicationDeploy, {
				applicationName: name,
			});

			return Effect.gen(function* () {
				if (follow) {
					yield* Effect.sync(() => emitStreamStart(command));
				}

				const environment = yield* resolveEnvironmentEffect(
					options.environment,
				);

				const deployResult: DeployResult = yield* applicationDeployEffect(
					name,
					{
						configPath: options.config,
						env: environment,
						onProgress: follow ? emitDeployProgressAsStream : undefined,
					},
				);
				const payload = buildDeployPayload(name, deployResult);

				yield* Effect.sync(() => {
					if (follow) {
						emitStreamResult(command, payload, nextActions);
						return;
					}

					emitSuccess(command, payload, nextActions);
				});
			}).pipe(
				Effect.catchAll((error) =>
					Effect.sync(() => {
						if (follow) {
							const mapped = mapRuntimeError(error);
							emitStreamError(
								command,
								{ message: mapped.message, code: mapped.code },
								mapped.fix,
								nextActions,
							);
							return;
						}

						emitRuntimeError("applicationGroup", error);
					}),
				),
			);
		});

	return app;
}
