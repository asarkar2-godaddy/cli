import * as Effect from "effect/Effect";
import {
	type HttpMethod,
	apiRequestEffect,
	parseFieldsEffect,
	parseHeadersEffect,
	readBodyFromFileEffect,
} from "../../core/api";
import { ValidationError } from "../../effect/errors";
import { getVerbosityLevel } from "../../services/logger";
import { mapRuntimeError } from "../agent/errors";
import { nextActionsFor } from "../agent/next-actions";
import { commandIds } from "../agent/registry";
import { currentCommandString, emitError, emitSuccess } from "../agent/respond";
import { Command } from "../command-model";

const VALID_METHODS: readonly HttpMethod[] = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
];

/**
 * Extract a value from an object using a simple JSON path
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

function normalizeStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === "string");
	}

	if (typeof value === "string") {
		return [value];
	}

	return [];
}

interface ApiCommandOptions {
	method?: string;
	field?: string[];
	file?: string;
	header?: string[];
	query?: string;
	include?: boolean;
}

export function createApiCommand(): Command {
	return new Command("api")
		.description("Make authenticated requests to the GoDaddy API")
		.argument("<endpoint>", "API endpoint (for example: /v1/domains)")
		.option(
			"-X, --method <method>",
			"HTTP method (GET, POST, PUT, PATCH, DELETE)",
		)
		.option(
			"-f, --field <key=value>",
			"Add request body field (can be repeated)",
			undefined,
			true,
		)
		.option("-F, --file <path>", "Read request body from JSON file")
		.option(
			"-H, --header <header>",
			"Add custom header (can be repeated)",
			undefined,
			true,
		)
		.option(
			"-q, --query <path>",
			"Extract a value from response JSON (for example: .data[0].id)",
		)
		.option("-i, --include", "Include response headers in result")
		.action((endpoint: string, rawOptions: unknown) =>
			Effect.gen(function* () {
				const options = (rawOptions ?? {}) as ApiCommandOptions;
				const methodInput = (options.method ?? "GET").toUpperCase();

				if (!VALID_METHODS.includes(methodInput as HttpMethod)) {
					return yield* Effect.fail(
						new ValidationError({
							message: `Invalid HTTP method: ${options.method ?? ""}`,
							userMessage: `Method must be one of: ${VALID_METHODS.join(", ")}`,
						}),
					);
				}

				const method = methodInput as HttpMethod;
				const fields = yield* parseFieldsEffect(
					normalizeStringArray(options.field),
				);
				const headers = yield* parseHeadersEffect(
					normalizeStringArray(options.header),
				);

				let body: string | undefined;
				if (typeof options.file === "string" && options.file.length > 0) {
					body = yield* readBodyFromFileEffect(options.file);
				}

				const response = yield* apiRequestEffect({
					endpoint,
					method,
					fields: Object.keys(fields).length > 0 ? fields : undefined,
					body,
					headers: Object.keys(headers).length > 0 ? headers : undefined,
					debug: getVerbosityLevel() >= 2,
				});

				let output = response.data;
				if (typeof options.query === "string" && output !== undefined) {
					try {
						output = extractPath(output, options.query);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						return yield* Effect.fail(
							new ValidationError({
								message: `Invalid query path: ${options.query}`,
								userMessage: `Query error: ${message}`,
							}),
						);
					}
				}

				emitSuccess(
					currentCommandString(),
					{
						endpoint: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
						method,
						status: response.status,
						status_text: response.statusText,
						headers: options.include ? response.headers : undefined,
						data: output ?? null,
					},
					nextActionsFor(commandIds.apiRequest),
				);
			}).pipe(
				Effect.catchAll((error) =>
					Effect.sync(() => {
						const mapped = mapRuntimeError(error);
						emitError(
							currentCommandString(),
							{ message: mapped.message, code: mapped.code },
							mapped.fix,
							nextActionsFor(commandIds.apiRequest),
						);
					}),
				),
			),
		);
}
