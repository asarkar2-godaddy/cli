import * as Effect from "effect/Effect";
import {
	envGetEffect,
	envInfoEffect,
	envListEffect,
	envSetEffect,
	getEnvironmentDisplay,
} from "../../core/environment";
import { mapRuntimeError } from "../agent/errors";
import { nextActionsFor } from "../agent/next-actions";
import {
	commandIds,
	findRegistryNodeById,
	registryNodeToResult,
} from "../agent/registry";
import { currentCommandString, emitError, emitSuccess } from "../agent/respond";
import { Command } from "../command-model";

function emitEnvError(error: unknown): void {
	const mapped = mapRuntimeError(error);
	emitError(
		currentCommandString(),
		{ message: mapped.message, code: mapped.code },
		mapped.fix,
		nextActionsFor(commandIds.envGroup),
	);
}

export function createEnvCommand(): Command {
	const env = new Command("env").description(
		"Manage GoDaddy environments (ote, prod)",
	);

	env.action(() =>
		Effect.sync(() => {
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
		}),
	);

	env
		.command("list")
		.description("List all available environments")
		.action(() =>
			Effect.gen(function* () {
				const environments = yield* envListEffect();
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
			}).pipe(
				Effect.catchAll((error) => Effect.sync(() => emitEnvError(error))),
			),
		);

	env
		.command("get")
		.description("Get current active environment")
		.action(() =>
			Effect.gen(function* () {
				const environment = yield* envGetEffect();

				emitSuccess(
					currentCommandString(),
					{ environment },
					nextActionsFor(commandIds.envGet),
				);
			}).pipe(
				Effect.catchAll((error) => Effect.sync(() => emitEnvError(error))),
			),
		);

	env
		.command("set")
		.description("Set active environment")
		.argument("<environment>", "Environment to set (ote|prod)")
		.action((environment: string) =>
			Effect.gen(function* () {
				const previousEnvironment = yield* envGetEffect();
				yield* envSetEffect(environment);

				emitSuccess(
					currentCommandString(),
					{
						previous_environment: previousEnvironment,
						environment,
					},
					nextActionsFor(commandIds.envSet),
				);
			}).pipe(
				Effect.catchAll((error) => Effect.sync(() => emitEnvError(error))),
			),
		);

	env
		.command("info")
		.description("Show detailed information about an environment")
		.argument("[environment]", "Environment to show info for")
		.action((environment: string | undefined) =>
			Effect.gen(function* () {
				const info = yield* envInfoEffect(environment);

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
									authorization_scopes: info.config.authorization_scopes,
								}
							: null,
					},
					nextActionsFor(commandIds.envInfo, {
						environment: info.environment,
					}),
				);
			}).pipe(
				Effect.catchAll((error) => Effect.sync(() => emitEnvError(error))),
			),
		);

	return env;
}
