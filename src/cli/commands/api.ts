import * as Args from "@effect/cli/Args";
import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
	type HttpMethod,
	apiRequestEffect,
	parseFieldsEffect,
	parseHeadersEffect,
	readBodyFromFileEffect,
} from "../../core/api";
import { ValidationError } from "../../effect/errors";
import { CliConfig } from "../services/cli-config";
import { EnvelopeWriter } from "../services/envelope-writer";
import type { NextAction } from "../agent/types";

const VALID_METHODS: readonly HttpMethod[] = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
];

// ---------------------------------------------------------------------------
// Colocated next_actions
// ---------------------------------------------------------------------------

const apiRequestActions: NextAction[] = [
	{
		command: "godaddy api <endpoint>",
		description: "Call another API endpoint",
		params: {
			endpoint: {
				description: "Relative API endpoint (for example /v1/domains)",
				required: true,
			},
		},
	},
	{ command: "godaddy auth status", description: "Check auth status" },
	{ command: "godaddy env get", description: "Check active environment" },
];

// ---------------------------------------------------------------------------
// extractPath — public for unit testing
// ---------------------------------------------------------------------------

/**
 * Extract a value from an object using a simple JSON path.
 * Supports: .key, .key.nested, .key[0], .key[0].nested
 */
export function extractPath(obj: unknown, path: string): unknown {
	if (!path || path === ".") {
		return obj;
	}

	const normalizedPath = path.startsWith(".") ? path.slice(1) : path;
	if (!normalizedPath) {
		return obj;
	}

	const segments: Array<string | number> = [];
	const regex = /([\w-]+)|\[(\d+)\]/g;
	for (const match of normalizedPath.matchAll(regex)) {
		const key = match[1];
		const index = match[2];
		if (key !== undefined) {
			segments.push(key);
		} else if (index !== undefined) {
			segments.push(Number.parseInt(index, 10));
		}
	}

	let current: unknown = obj;
	for (const segment of segments) {
		if (current === null || current === undefined) {
			return undefined;
		}

		if (typeof segment === "number") {
			if (!Array.isArray(current)) {
				throw new Error(`Cannot index non-array with [${segment}]`);
			}
			current = current[segment];
			continue;
		}

		if (typeof current !== "object") {
			throw new Error(`Cannot access property "${segment}" on non-object`);
		}

		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeStringArray(value: ReadonlyArray<string>): string[] {
	return value.filter((entry): entry is string => typeof entry === "string");
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

const apiCommand = Command.make(
	"api",
	{
		endpoint: Args.text({ name: "endpoint" }).pipe(
			Args.withDescription("API endpoint (for example: /v1/domains)"),
		),
		method: Options.text("method").pipe(
			Options.withAlias("X"),
			Options.withDescription("HTTP method (GET, POST, PUT, PATCH, DELETE)"),
			Options.withDefault("GET"),
		),
		field: Options.text("field").pipe(
			Options.withAlias("f"),
			Options.withDescription("Add request body field (can be repeated)"),
			Options.repeated,
		),
		file: Options.text("file").pipe(
			Options.withAlias("F"),
			Options.withDescription("Read request body from JSON file"),
			Options.optional,
		),
		header: Options.text("header").pipe(
			Options.withAlias("H"),
			Options.withDescription("Add custom header (can be repeated)"),
			Options.repeated,
		),
		query: Options.text("query").pipe(
			Options.withAlias("q"),
			Options.withDescription(
				"Extract a value from response JSON (for example: .data[0].id)",
			),
			Options.optional,
		),
		include: Options.boolean("include").pipe(
			Options.withAlias("i"),
			Options.withDescription("Include response headers in result"),
		),
	},
	(config) =>
		Effect.gen(function* () {
			const writer = yield* EnvelopeWriter;
			const cliConfig = yield* CliConfig;
			const methodInput = config.method.toUpperCase();

			if (!VALID_METHODS.includes(methodInput as HttpMethod)) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Invalid HTTP method: ${config.method}`,
						userMessage: `Method must be one of: ${VALID_METHODS.join(", ")}`,
					}),
				);
			}

			const method = methodInput as HttpMethod;
			const fields = yield* parseFieldsEffect(normalizeStringArray(config.field));
			const headers = yield* parseHeadersEffect(
				normalizeStringArray(config.header),
			);

			let body: string | undefined;
			const filePath = Option.getOrUndefined(config.file);
			if (typeof filePath === "string" && filePath.length > 0) {
				body = yield* readBodyFromFileEffect(filePath);
			}

			const response = yield* apiRequestEffect({
				endpoint: config.endpoint,
				method,
				fields: Object.keys(fields).length > 0 ? fields : undefined,
				body,
				headers: Object.keys(headers).length > 0 ? headers : undefined,
				debug: cliConfig.verbosity >= 2,
			});

			let output = response.data;
			const queryPath = Option.getOrUndefined(config.query);
			if (typeof queryPath === "string" && output !== undefined) {
				try {
					output = extractPath(output, queryPath);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					return yield* Effect.fail(
						new ValidationError({
							message: `Invalid query path: ${queryPath}`,
							userMessage: `Query error: ${message}`,
						}),
					);
				}
			}

			yield* writer.emitSuccess("godaddy api", {
				endpoint: config.endpoint.startsWith("/")
					? config.endpoint
					: `/${config.endpoint}`,
				method,
				status: response.status,
				status_text: response.statusText,
				headers: config.include ? response.headers : undefined,
				data: output ?? null,
			}, apiRequestActions);
		}),
).pipe(
	Command.withDescription("Make authenticated requests to the GoDaddy API"),
);

export { apiCommand };
