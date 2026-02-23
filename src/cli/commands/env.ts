import { Command } from "commander";
import {
	type Environment,
	envGet,
	envInfo,
	envList,
	envSet,
	getEnvironmentDisplay,
} from "../../core/environment";
import { mapRuntimeError } from "../agent/errors";
import {
	commandIds,
	findRegistryNodeById,
	registryNodeToResult,
} from "../agent/registry";
import { nextActionsFor } from "../agent/next-actions";
import {
	currentCommandString,
	emitError,
	emitSuccess,
	unwrapResult,
} from "../agent/respond";

export function createEnvCommand(): Command {
	const env = new Command("env").description(
		"Manage GoDaddy environments (ote, prod)",
	);

	env.action(async () => {
		const node = findRegistryNodeById(commandIds.envGroup);
		if (!node) {
			const mapped = mapRuntimeError(
				new Error("Environment command registry metadata is missing"),
			);
			emitError(
				currentCommandString(),
				{ message: mapped.message, code: mapped.code },
				mapped.fix,
				nextActionsFor(commandIds.root),
			);
			return;
		}

		emitSuccess(
			currentCommandString(),
			registryNodeToResult(node),
			nextActionsFor(commandIds.envGroup),
		);
	});

	env
		.command("list")
		.description("List all available environments")
		.action(async () => {
			try {
				const environments = unwrapResult(
					await envList(),
					"Failed to list environments",
				);
				const activeEnvironment = environments[0];

				emitSuccess(
					currentCommandString(),
					{
						active_environment: activeEnvironment,
						environments: environments.map((environment) => ({
							environment,
							display: getEnvironmentDisplay(environment),
						})),
					},
					nextActionsFor(commandIds.envList),
				);
			} catch (error) {
				const mapped = mapRuntimeError(error);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.envGroup),
				);
			}
		});

	env
		.command("get")
		.description("Get current active environment")
		.action(async () => {
			try {
				const environment = unwrapResult(
					await envGet(),
					"Failed to get environment",
				) as Environment;

				emitSuccess(
					currentCommandString(),
					{ environment },
					nextActionsFor(commandIds.envGet),
				);
			} catch (error) {
				const mapped = mapRuntimeError(error);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.envGroup),
				);
			}
		});

	env
		.command("set")
		.description("Set active environment")
		.argument("<environment>", "Environment to set (ote|prod)")
		.action(async (environment: string) => {
			try {
				const previousEnvironment = unwrapResult(
					await envGet(),
					"Failed to get current environment",
				) as Environment;
				unwrapResult(await envSet(environment), "Failed to set environment");

				emitSuccess(
					currentCommandString(),
					{
						previous_environment: previousEnvironment,
						environment,
					},
					nextActionsFor(commandIds.envSet),
				);
			} catch (error) {
				const mapped = mapRuntimeError(error);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.envGroup),
				);
			}
		});

	env
		.command("info")
		.description("Show detailed information about an environment")
		.argument("[environment]", "Environment to show info for")
		.action(async (environment: string | undefined) => {
			try {
				const info = unwrapResult(
					await envInfo(environment),
					"Failed to get environment info",
				);

				emitSuccess(
					currentCommandString(),
					{
						environment: info.environment,
						display: info.display,
						config_file: info.configFile,
						config_summary: info.config
							? {
								name: info.config.name,
								client_id: info.config.client_id,
								version: info.config.version,
								url: info.config.url,
								proxy_url: info.config.proxy_url,
								authorization_scopes:
									info.config.authorization_scopes,
							}
							: null,
					},
					nextActionsFor(commandIds.envInfo, {
						environment: info.environment,
					}),
				);
			} catch (error) {
				const mapped = mapRuntimeError(error);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.envGroup),
				);
			}
		});

	return env;
}
