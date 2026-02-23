#!/usr/bin/env node

import * as Args from "@effect/cli/Args";
import * as CliConfig from "@effect/cli/CliConfig";
import * as CommandDescriptor from "@effect/cli/CommandDescriptor";
import * as HelpDoc from "@effect/cli/HelpDoc";
import * as Options from "@effect/cli/Options";
import * as NodeContext from "@effect/platform-node/NodeContext";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import packageJson from "../package.json";
import { createAuthCommand, createEnvCommand } from "./cli";
import {
	mapLeftoverTokens,
	mapRuntimeError,
	mapValidationError,
} from "./cli/agent/errors";
import { nextActionsFor } from "./cli/agent/next-actions";
import { commandIds, getRootCommandTree } from "./cli/agent/registry";
import {
	currentCommandString,
	emitError,
	emitSuccess,
	setEnvelopePrettyPrint,
} from "./cli/agent/respond";
import { Command, getCanonicalPath } from "./cli/command-model";
import { createActionsCommand } from "./cli/commands/actions";
import { createApiCommand } from "./cli/commands/api";
import { createApplicationCommand } from "./cli/commands/application";
import { createWebhookCommand } from "./cli/commands/webhook";
import { authStatusEffect } from "./core/auth";
import {
	envGetEffect,
	setRuntimeEnvironmentOverride,
	validateEnvironment,
} from "./core/environment";
import { NodeLiveLayer } from "./effect/runtime";
import { FileSystemLive } from "./effect/layers/node-live";
import { FileSystem } from "./effect/services/filesystem";
import { setTruncationFs } from "./cli/agent/truncation";
import { setVerbosityLevel } from "./services/logger";

type Descriptor = CommandDescriptor.Command<unknown>;

interface ParsedCommandValue {
	readonly options?: Record<string, unknown>;
	readonly args?: unknown;
	readonly subcommand?: Option.Option<readonly [string, ParsedCommandValue]>;
}

const EFFECT_CLI_CONFIG = CliConfig.make({
	isCaseSensitive: true,
	finalCheckBuiltIn: true,
	showBuiltIns: true,
});

function isShortVerboseCluster(token: string): boolean {
	return /^-v{2,}$/.test(token);
}

function normalizeVerbosityArgs(argv: ReadonlyArray<string>): string[] {
	const retained: string[] = [];
	let verbosity = 0;

	for (const token of argv) {
		if (token === "--debug") {
			verbosity = Math.max(verbosity, 2);
			continue;
		}

		if (token === "--info" || token === "--verbose") {
			verbosity += 1;
			continue;
		}

		if (token === "-v") {
			verbosity += 1;
			continue;
		}

		if (isShortVerboseCluster(token)) {
			const level = token.length - 1;
			verbosity += level;
			continue;
		}

		retained.push(token);
	}

	const normalizedVerbosity = Math.min(verbosity, 2);

	if (normalizedVerbosity >= 2) {
		return ["--debug", ...retained];
	}

	if (normalizedVerbosity === 1) {
		return ["--verbose", ...retained];
	}

	return retained;
}

function normalizePrettyArgs(argv: ReadonlyArray<string>): string[] {
	const retained: string[] = [];
	let pretty = false;

	for (const token of argv) {
		if (token === "--pretty") {
			pretty = true;
			continue;
		}

		retained.push(token);
	}

	if (pretty) {
		return ["--pretty", ...retained];
	}

	return retained;
}

function normalizeGlobalArgs(argv: ReadonlyArray<string>): string[] {
	return normalizePrettyArgs(normalizeVerbosityArgs(argv));
}

function buildOptionsParser(
	options: ReadonlyArray<Command["options"][number]>,
): Options.Options<unknown> {
	if (options.length === 0) {
		return Options.none;
	}

	const optionMap: Record<string, Options.Options<unknown>> = {};

	for (const option of options) {
		let parser: Options.Options<unknown> = option.takesValue
			? Options.text(option.longName)
			: Options.boolean(option.longName);

		if (option.takesValue && option.multiple) {
			parser = Options.repeated(parser);
		}

		if (option.shortName) {
			parser = Options.withAlias(parser, option.shortName);
		}

		if (option.description) {
			parser = Options.withDescription(parser, option.description);
		}

		if (option.takesValue && !option.required && !option.multiple) {
			parser = Options.optional(parser);
		}

		optionMap[option.key] = parser;
	}

	return Options.all(optionMap);
}

function buildArgsParser(args: ReadonlyArray<Command["arguments"][number]>) {
	if (args.length === 0) {
		return undefined;
	}

	if (args.length === 1) {
		const definition = args[0];
		let parser: Args.Args<unknown> = Args.text({ name: definition.name });

		if (!definition.required) {
			parser = Args.optional(parser);
		}

		if (definition.description) {
			parser = Args.withDescription(parser, definition.description);
		}

		return parser;
	}

	const parsers = args.map((definition) => {
		let parser: Args.Args<unknown> = Args.text({ name: definition.name });
		if (!definition.required) {
			parser = Args.optional(parser);
		}
		if (definition.description) {
			parser = Args.withDescription(parser, definition.description);
		}
		return parser;
	});

	return Args.all(parsers);
}

function buildDescriptor(command: Command, overrideName?: string): Descriptor {
	const optionsParser = buildOptionsParser(command.options);
	const argsParser = buildArgsParser(command.arguments);
	const name = overrideName ?? command.name;

	let descriptor: Descriptor =
		typeof argsParser === "undefined"
			? CommandDescriptor.make(name, optionsParser)
			: CommandDescriptor.make(name, optionsParser, argsParser);

	const description = command.getDescription();
	if (description.length > 0) {
		descriptor = CommandDescriptor.withDescription(descriptor, description);
	}

	if (command.commands.length > 0) {
		const subcommands: Array<readonly [string, Descriptor]> = [];

		for (const child of command.commands) {
			subcommands.push([child.name, buildDescriptor(child)]);

			for (const alias of child.getAliases()) {
				subcommands.push([child.name, buildDescriptor(child, alias)]);
			}
		}

		descriptor = CommandDescriptor.withSubcommands(
			descriptor,
			subcommands as [
				readonly [string, Descriptor],
				...Array<readonly [string, Descriptor]>,
			],
		);
	}

	return descriptor;
}

function unwrapOptionalValue<T>(value: unknown): T | undefined {
	if (!Option.isOption(value) || Option.isNone(value)) {
		return undefined;
	}

	return value.value as T;
}

function extractCommandOptions(
	command: Command,
	parsedValue: ParsedCommandValue,
): Record<string, unknown> {
	const parsedOptions = (parsedValue.options ?? {}) as Record<string, unknown>;
	const options: Record<string, unknown> = {};

	for (const option of command.options) {
		const rawValue = parsedOptions[option.key];

		if (!option.takesValue) {
			options[option.key] = Boolean(rawValue);
			continue;
		}

		if (option.multiple) {
			const optionalList = unwrapOptionalValue<readonly string[]>(rawValue);
			const listSource = optionalList ?? rawValue;
			const list = Array.isArray(listSource)
				? listSource
				: typeof listSource === "string"
					? [listSource]
					: [];
			const parser = option.parser;
			options[option.key] =
				typeof parser === "function"
					? list.map((value) => parser(value))
					: list;
			continue;
		}

		let normalizedValue = option.required
			? rawValue
			: unwrapOptionalValue<string>(rawValue);

		const parser = option.parser;
		if (typeof normalizedValue === "string" && typeof parser === "function") {
			normalizedValue = parser(normalizedValue);
		}

		options[option.key] = normalizedValue;
	}

	return options;
}

function extractCommandArguments(
	command: Command,
	parsedValue: ParsedCommandValue,
): unknown[] {
	if (command.arguments.length === 0) {
		return [];
	}

	const parsedArgs = parsedValue.args;

	if (command.arguments.length === 1) {
		const [argument] = command.arguments;
		return [argument.required ? parsedArgs : unwrapOptionalValue(parsedArgs)];
	}

	if (!Array.isArray(parsedArgs)) {
		return [];
	}

	return command.arguments.map((argument, index) =>
		argument.required
			? parsedArgs[index]
			: unwrapOptionalValue(parsedArgs[index]),
	);
}

function resolveParsedCommand(
	rootCommand: Command,
	parsedRootValue: ParsedCommandValue,
): { command: Command; parsedValue: ParsedCommandValue } {
	let currentCommand = rootCommand;
	let currentValue = parsedRootValue;

	while (true) {
		const subcommand = currentValue.subcommand;
		if (
			typeof subcommand !== "object" ||
			subcommand === null ||
			!("_tag" in subcommand) ||
			Option.isNone(subcommand as Option.Option<unknown>)
		) {
			break;
		}

		const [subcommandName, nextValue] = (
			subcommand as Option.Some<readonly [string, ParsedCommandValue]>
		).value;
		const nextCommand = currentCommand.commands.find(
			(command) => command.name === subcommandName,
		);

		if (!nextCommand) {
			throw new Error(`Unable to resolve parsed subcommand: ${subcommandName}`);
		}

		currentCommand = nextCommand;
		currentValue = nextValue;
	}

	return { command: currentCommand, parsedValue: currentValue };
}

function invokeCommandAction(
	command: Command,
	parsedValue: ParsedCommandValue,
): Effect.Effect<void, unknown, never> {
	const action = command.getAction();

	if (!action) {
		throw new Error(
			`No action configured for command '${getCanonicalPath(command)}'`,
		);
	}

	const argumentsList = extractCommandArguments(command, parsedValue);
	const options = extractCommandOptions(command, parsedValue);

	let effect: Effect.Effect<unknown, unknown, unknown>;

	if (argumentsList.length > 0 && command.options.length > 0) {
		effect = action(...argumentsList, options);
	} else if (argumentsList.length > 0) {
		effect = action(...argumentsList);
	} else if (command.options.length > 0) {
		effect = action(options);
	} else {
		effect = action();
	}

	return effect.pipe(
		Effect.provide(NodeLiveLayer),
		Effect.asVoid,
	) as Effect.Effect<void, unknown, never>;
}

function applyGlobalOptions(
	rootCommand: Command,
	parsedRootValue: ParsedCommandValue,
): void {
	const options = extractCommandOptions(rootCommand, parsedRootValue);
	setEnvelopePrettyPrint(options.pretty === true);

	let verbosity = 0;
	if (options.verbose === true || options.info === true) {
		verbosity = 1;
	}
	if (options.debug === true) {
		verbosity = 2;
	}

	if (verbosity > 0) {
		setVerbosityLevel(verbosity);
		if (verbosity === 1) {
			process.stderr.write("(verbose output enabled)\n");
		} else {
			process.stderr.write("(verbose output enabled: full details)\n");
		}
	}

	const environment = typeof options.env === "string" ? options.env : undefined;
	if (environment) {
		setRuntimeEnvironmentOverride(validateEnvironment(environment));
	} else {
		setRuntimeEnvironmentOverride(null);
	}
}

function emitRootError(details: {
	message: string;
	code: string;
	fix: string;
}): void {
	emitError(
		currentCommandString(),
		{ message: details.message, code: details.code },
		details.fix,
		nextActionsFor(commandIds.root),
	);
}

function writeHelp(helpDoc: HelpDoc.HelpDoc): void {
	const text = HelpDoc.toAnsiText(helpDoc);
	process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function toParsedCommandValue(value: unknown): ParsedCommandValue {
	if (typeof value !== "object" || value === null) {
		throw new Error("Invalid command parse output");
	}

	return value as ParsedCommandValue;
}

export function createCliProgram(): Command {
	const program = new Command("godaddy")
		.description(
			"GoDaddy Developer Platform CLI - Agent-first JSON interface for platform operations",
		)
		.option(
			"-e, --env <environment>",
			"Set the target environment for commands (ote, prod)",
		)
		.option(
			"-v, --verbose",
			"Enable basic verbose output for HTTP requests and responses",
		)
		.option("--info", "Enable basic verbose output (same as -v)")
		.option("--debug", "Enable full verbose output (same as -vv)")
		.option("--pretty", "Pretty-print JSON envelopes with 2-space indentation")
		.action(() =>
			Effect.gen(function* () {
				const environment = yield* envGetEffect().pipe(
					Effect.map((env) => ({ active: env })),
					Effect.catchAll((error) =>
						Effect.succeed({
							error: error.message,
						}),
					),
				);
				const commandTree = getRootCommandTree();
				const authSnapshot = yield* authStatusEffect().pipe(
					Effect.map(
						(status) =>
							({
								authenticated: status.authenticated,
								has_token: status.hasToken,
								token_expiry: status.tokenExpiry?.toISOString(),
								environment: status.environment,
							}) as Record<string, unknown>,
					),
					Effect.catchAll((error) =>
						Effect.succeed({
							error: error.message,
						} as Record<string, unknown>),
					),
				);

				emitSuccess(
					currentCommandString(),
					{
						description: commandTree.description,
						version: packageJson.version,
						environment,
						authentication: authSnapshot,
						command_tree: commandTree,
					},
					nextActionsFor(commandIds.root),
				);
			}),
		);

	program.addCommand(createEnvCommand());
	program.addCommand(createAuthCommand());
	program.addCommand(createApiCommand());
	program.addCommand(createActionsCommand());
	program.addCommand(createApplicationCommand());
	program.addCommand(createWebhookCommand());

	return program;
}

export function runCliEffect(
	argv: ReadonlyArray<string>,
): Effect.Effect<void, unknown, never> {
	return Effect.gen(function* () {
		// Initialize the truncation FS from the live layer so truncation output
		// uses the same FileSystem service as the rest of the CLI.
		const fsService = yield* FileSystem.pipe(Effect.provide(FileSystemLive));
		setTruncationFs(fsService);

		const rootCommand = createCliProgram();
		const descriptor = buildDescriptor(rootCommand);
		const normalizedArgv = normalizeGlobalArgs(argv);
		setEnvelopePrettyPrint(normalizedArgv.includes("--pretty"));

		const parseEffect = CommandDescriptor.parse(
			descriptor,
			[rootCommand.name, ...normalizedArgv],
			EFFECT_CLI_CONFIG,
		).pipe(Effect.provide(NodeContext.layer));

		const parseExit = yield* Effect.exit(parseEffect);

		if (Exit.isFailure(parseExit)) {
			const validationError = Option.getOrUndefined(
				Cause.failureOption(parseExit.cause),
			);

			if (validationError) {
				emitRootError(mapValidationError(validationError));
				return;
			}

			return yield* Effect.fail(Cause.squash(parseExit.cause));
		}

		const directive = parseExit.value;

		if (directive._tag === "BuiltIn") {
			if (directive.option._tag === "ShowHelp") {
				writeHelp(directive.option.helpDoc);
				return;
			}

			if (directive.option._tag === "ShowVersion") {
				process.stdout.write(`${packageJson.version}\n`);
				return;
			}

			emitRootError(
				mapRuntimeError(
					new Error(
						`Built-in option '${directive.option._tag}' is not supported in this runtime`,
					),
				),
			);
			return;
		}

		const parsedRootValue = toParsedCommandValue(directive.value);

		if (directive.leftover.length > 0) {
			emitRootError(mapLeftoverTokens(directive.leftover));
			return;
		}

		applyGlobalOptions(rootCommand, parsedRootValue);

		const { command, parsedValue } = resolveParsedCommand(
			rootCommand,
			parsedRootValue,
		);

		yield* invokeCommandAction(command, parsedValue);
	});
}

export function runCli(argv: ReadonlyArray<string>): Promise<void> {
	return Effect.runPromise(runCliEffect(argv));
}
