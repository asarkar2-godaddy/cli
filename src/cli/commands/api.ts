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
import { authLoginEffect, getTokenInfoEffect } from "../../core/auth";
import { AuthenticationError, ValidationError } from "../../effect/errors";
import type { NextAction } from "../agent/types";
import { CliConfig } from "../services/cli-config";
import { EnvelopeWriter } from "../services/envelope-writer";

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

// ---------------------------------------------------------------------------
// Helpers — JWT scope check
// ---------------------------------------------------------------------------

/** Decode a JWT payload without verification (we only need the claims). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
		return JSON.parse(payload) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** Check whether a JWT already contains every scope in `required`. */
function tokenHasScopes(token: string, required: string[]): boolean {
	if (required.length === 0) return true;
	const claims = decodeJwtPayload(token);
	if (!claims || typeof claims.scope !== "string") return false;
	const granted = new Set(claims.scope.split(/\s+/));
	return required.every((s) => granted.has(s));
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
		scope: Options.text("scope").pipe(
			Options.withAlias("s"),
			Options.withDescription(
				"Required OAuth scope. On 403, triggers auth and retries (can be repeated)",
			),
			Options.repeated,
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
			const fields = yield* parseFieldsEffect(
				normalizeStringArray(config.field),
			);
			const headers = yield* parseHeadersEffect(
				normalizeStringArray(config.header),
			);

			let body: string | undefined;
			const filePath = Option.getOrUndefined(config.file);
			if (typeof filePath === "string" && filePath.length > 0) {
				body = yield* readBodyFromFileEffect(filePath);
			}

			const requiredScopes = config.scope
				.flatMap((s) =>
					s
						.split(/[\s,]+/)
						.map((t) => t.trim())
						.filter((t) => t.length > 0),
				);

			const requestOpts = {
				endpoint: config.endpoint,
				method,
				fields: Object.keys(fields).length > 0 ? fields : undefined,
				body,
				headers: Object.keys(headers).length > 0 ? headers : undefined,
				debug: cliConfig.verbosity >= 2,
			};

			// First attempt
			const response = yield* apiRequestEffect(requestOpts).pipe(
				Effect.catchAll((error) => {
					// On 403 with --scope: check if the token is missing the scope,
					// trigger auth, and retry — once.
					if (
						error._tag === "AuthenticationError" &&
						error.message.includes("403") &&
						requiredScopes.length > 0
					) {
						return Effect.gen(function* () {
							// Get current token to inspect scopes
							const tokenInfo = yield* getTokenInfoEffect().pipe(
								Effect.catchAll(() => Effect.succeed(null)),
							);

							if (
								tokenInfo &&
								tokenHasScopes(tokenInfo.accessToken, requiredScopes)
							) {
								// Token already has the scopes — the 403 is not a scope issue
								return yield* Effect.fail(error);
							}

							// Token is missing required scopes — re-auth and retry
							if (cliConfig.verbosity >= 1) {
								process.stderr.write(
									`Token missing scope(s): ${requiredScopes.join(", ")}. Triggering auth flow...\n`,
								);
							}

							const loginResult = yield* authLoginEffect({
								additionalScopes: requiredScopes,
							}).pipe(
								Effect.catchAll(() =>
									Effect.fail(
										new AuthenticationError({
											message: "Re-authentication failed",
											userMessage:
												"Automatic re-authentication failed. Run 'godaddy auth login' manually.",
										}),
									),
								),
							);

							if (!loginResult.success) {
								return yield* Effect.fail(
									new AuthenticationError({
										message: "Re-authentication did not succeed",
										userMessage:
											"Authentication did not complete. Run 'godaddy auth login' manually.",
									}),
								);
							}

							// Retry the request with the new token
							return yield* apiRequestEffect(requestOpts);
						});
					}
					return Effect.fail(error);
				}),
			);

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

			yield* writer.emitSuccess(
				"godaddy api",
				{
					endpoint: config.endpoint.startsWith("/")
						? config.endpoint
						: `/${config.endpoint}`,
					method,
					status: response.status,
					status_text: response.statusText,
					headers: config.include ? response.headers : undefined,
					data: output ?? null,
				},
				apiRequestActions,
			);
		}),
).pipe(
	Command.withDescription("Make authenticated requests to the GoDaddy API"),
);

export { apiCommand };
