#!/usr/bin/env node

import { Command } from "commander";
import packageJson from "../package.json";
import { createAuthCommand, createEnvCommand } from "./cli";
import { commandIds, getRootCommandTree } from "./cli/agent/registry";
import { nextActionsFor } from "./cli/agent/next-actions";
import { currentCommandString, emitSuccess } from "./cli/agent/respond";
import { createActionsCommand } from "./cli/commands/actions";
import { createApplicationCommand } from "./cli/commands/application";
import { createWebhookCommand } from "./cli/commands/webhook";
import { envGet, validateEnvironment } from "./core/environment";
import { setDebugMode } from "./services/logger";

/**
 * Agent-first CLI entry point using commander.js
 */
function configureCommandOutput(command: Command): void {
	command
		.showSuggestionAfterError(false)
		.showHelpAfterError(false)
		.configureOutput({
			writeOut: (str) => {
				process.stdout.write(str);
			},
			writeErr: () => {
				// Parse and command errors are emitted as JSON envelopes elsewhere.
			},
		})
		.exitOverride();

	for (const subcommand of command.commands) {
		configureCommandOutput(subcommand);
	}
}

export function createCliProgram(): Command {
	const program = new Command();

	program
		.name("godaddy")
		.description(
			"GoDaddy Developer Platform CLI - Agent-first JSON interface for platform operations",
		)
		.version(packageJson.version)
		.option(
			"-e, --env <environment>",
			"Set the target environment for commands (ote, prod)",
		)
		.option("--debug", "Enable debug logging for HTTP requests and responses")
		.action(async () => {
			const envResult = await envGet();
			const commandTree = getRootCommandTree();
			let authSnapshot:
				| { error: string }
				| Record<string, unknown>
				| undefined;

			try {
				const authModule = await import("./core/auth");
				const authResult = await authModule.authStatus();
				authSnapshot = authResult.success
					? (authResult.data as Record<string, unknown>)
					: { error: authResult.error?.message ?? "unknown" };
			} catch (error) {
				authSnapshot = {
					error:
						error instanceof Error
							? error.message
							: "Failed to load auth module",
				};
			}

			emitSuccess(
				currentCommandString(),
				{
					description: commandTree.description,
					version: packageJson.version,
					environment: envResult.success
						? { active: envResult.data }
						: { error: envResult.error?.message ?? "unknown" },
					authentication: authSnapshot,
					command_tree: commandTree,
				},
				nextActionsFor(commandIds.root),
			);
		});

	program.hook("preAction", async (thisCommand) => {
		const options = thisCommand.opts();

		if (options.debug) {
			setDebugMode(true);
		}

		if (options.env) {
			validateEnvironment(options.env);
		}
	});

	program.addCommand(createEnvCommand());
	program.addCommand(createAuthCommand());
	program.addCommand(createActionsCommand());
	program.addCommand(createApplicationCommand());
	program.addCommand(createWebhookCommand());
	configureCommandOutput(program);

	return program;
}
