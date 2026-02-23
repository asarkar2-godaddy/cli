import * as Effect from "effect/Effect";

export type CommandValueParser = (value: string, previous?: unknown) => unknown;

export interface CommandArgumentDefinition {
	name: string;
	required: boolean;
	description?: string;
}

export interface CommandOptionDefinition {
	key: string;
	longName: string;
	shortName?: string;
	required: boolean;
	multiple: boolean;
	takesValue: boolean;
	valueName?: string;
	description?: string;
	parser?: CommandValueParser;
}

export type CommandAction = (
	...args: unknown[]
	// biome-ignore lint/suspicious/noExplicitAny: service requirements are erased at the command boundary
) => Effect.Effect<unknown, unknown, any>;

function toCamelCase(value: string): string {
	return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function parseOptionSegment(segment: string): {
	name: string;
	takesValue: boolean;
	valueName?: string;
} {
	const match = segment
		.trim()
		.match(/^--?([a-zA-Z0-9-]+)(?:\s+(?:<([^>]+)>|\[([^\]]+)\]))?$/);

	if (!match) {
		throw new Error(`Unsupported option definition: ${segment}`);
	}

	return {
		name: match[1],
		takesValue: Boolean(match[2] || match[3]),
		valueName: match[2] || match[3] || undefined,
	};
}

function parseOptionFlags(
	flags: string,
	required: boolean,
	multiple: boolean,
	description?: string,
	parser?: CommandValueParser,
): CommandOptionDefinition {
	const segments = flags
		.split(",")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);

	const longSegment = segments.find((segment) => segment.startsWith("--"));
	if (!longSegment) {
		throw new Error(`Option definition must include a long name: ${flags}`);
	}

	const long = parseOptionSegment(longSegment);
	const shortSegment = segments.find(
		(segment) => segment.startsWith("-") && !segment.startsWith("--"),
	);
	const short = shortSegment ? parseOptionSegment(shortSegment) : undefined;

	return {
		key: toCamelCase(long.name),
		longName: long.name,
		shortName: short?.name,
		required,
		multiple,
		takesValue: long.takesValue,
		valueName: long.valueName,
		description,
		parser,
	};
}

function parseArgumentDefinition(
	definition: string,
	description?: string,
): CommandArgumentDefinition {
	const value = definition.trim();
	const requiredMatch = value.match(/^<(.+)>$/);
	if (requiredMatch) {
		return {
			name: requiredMatch[1],
			required: true,
			description,
		};
	}

	const optionalMatch = value.match(/^\[(.+)\]$/);
	if (optionalMatch) {
		return {
			name: optionalMatch[1],
			required: false,
			description,
		};
	}

	throw new Error(`Unsupported argument definition: ${definition}`);
}

export class Command {
	readonly name: string;
	private descriptionValue = "";
	private readonly aliasValues: string[] = [];
	readonly commands: Command[] = [];
	readonly arguments: CommandArgumentDefinition[] = [];
	readonly options: CommandOptionDefinition[] = [];
	private actionValue: CommandAction | undefined;
	parent: Command | undefined;

	constructor(name: string) {
		this.name = name;
	}

	description(value: string): this {
		this.descriptionValue = value;
		return this;
	}

	alias(value: string): this {
		if (!this.aliasValues.includes(value)) {
			this.aliasValues.push(value);
		}
		return this;
	}

	command(name: string): Command {
		const child = new Command(name);
		child.parent = this;
		this.commands.push(child);
		return child;
	}

	addCommand(command: Command): this {
		command.parent = this;
		this.commands.push(command);
		return this;
	}

	argument(definition: string, description?: string): this {
		this.arguments.push(parseArgumentDefinition(definition, description));
		return this;
	}

	option(
		flags: string,
		description?: string,
		parser?: CommandValueParser,
		multiple = false,
	): this {
		this.options.push(
			parseOptionFlags(flags, false, multiple, description, parser),
		);
		return this;
	}

	requiredOption(
		flags: string,
		description?: string,
		parser?: CommandValueParser,
		multiple = false,
	): this {
		this.options.push(
			parseOptionFlags(flags, true, multiple, description, parser),
		);
		return this;
	}

	action<TArgs extends unknown[], TResult, R>(
		handler: (...args: TArgs) => Effect.Effect<TResult, unknown, R>,
	): this {
		this.actionValue = ((...args: unknown[]) =>
			Effect.suspend(() => handler(...(args as TArgs)))) as CommandAction;
		return this;
	}

	getDescription(): string {
		return this.descriptionValue;
	}

	getAliases(): ReadonlyArray<string> {
		return this.aliasValues;
	}

	getAction(): CommandAction | undefined {
		return this.actionValue;
	}
}

export function getCanonicalPathSegments(command: Command): string[] {
	const path: string[] = [];
	let current: Command | undefined = command;

	while (current) {
		path.unshift(current.name);
		current = current.parent;
	}

	return path;
}

export function getCanonicalPath(command: Command): string {
	return getCanonicalPathSegments(command).join(" ");
}
