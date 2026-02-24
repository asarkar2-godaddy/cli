import { Fetch } from "@effect/platform/FetchHttpClient";
import { FileSystem } from "@effect/platform/FileSystem";
import * as Effect from "effect/Effect";
import { v7 as uuid } from "uuid";
import {
	AuthenticationError,
	type CliError,
	NetworkError,
	ValidationError,
} from "../effect/errors";
import { fileExists } from "../effect/fs-utils";
import type { Keychain } from "../effect/services/keychain";
import { getTokenInfoEffect } from "./auth";
import { type Environment, envGetEffect, getApiUrl } from "./environment";

// Minimum seconds before expiry to consider token valid for a request
const TOKEN_EXPIRY_BUFFER_SECONDS = 30;

// Header names (lowercased) that must be redacted from debug output and
// the --include envelope to prevent leaking tokens, cookies, or secrets.
const SENSITIVE_HEADER_PARTS = [
	"authorization",
	"cookie",
	"set-cookie",
	"token",
	"secret",
	"api-key",
	"apikey",
	"x-auth",
] as const;

function isSensitiveHeader(headerName: string): boolean {
	const lower = headerName.toLowerCase();
	return SENSITIVE_HEADER_PARTS.some((part) => lower.includes(part));
}

/**
 * Return a copy of headers with sensitive values replaced by "[REDACTED]".
 */
export { sanitizeHeaders as sanitizeResponseHeaders };

function sanitizeHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	const sanitized: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		sanitized[key] = isSensitiveHeader(key) ? "[REDACTED]" : value;
	}
	return sanitized;
}

/**
 * Redact values whose keys look like they contain secrets.
 */
function redactSensitiveBodyFields(body: string): string {
	try {
		const parsed = JSON.parse(body);
		if (typeof parsed !== "object" || parsed === null) return body;
		const redacted: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(parsed)) {
			const lower = key.toLowerCase();
			const isSensitive = SENSITIVE_HEADER_PARTS.some((part) =>
				lower.includes(part),
			) || lower.includes("password") || lower.includes("credential");
			redacted[key] = isSensitive ? "[REDACTED]" : value;
		}
		return JSON.stringify(redacted);
	} catch {
		return body;
	}
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequestOptions {
	endpoint: string;
	method?: HttpMethod;
	fields?: Record<string, string>;
	body?: string;
	headers?: Record<string, string>;
	debug?: boolean;
}

export interface ApiResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	data: unknown;
}

/**
 * Parse field arguments into an object.
 * Fields are in the format "key=value".
 */
export function parseFieldsEffect(
	fields: string[],
): Effect.Effect<Record<string, string>, ValidationError, never> {
	return Effect.gen(function* () {
		const result: Record<string, string> = {};

		for (const field of fields) {
			const eqIndex = field.indexOf("=");
			if (eqIndex === -1) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Invalid field format: ${field}`,
						userMessage: `Invalid field format: "${field}". Expected "key=value".`,
					}),
				);
			}

			const key = field.slice(0, eqIndex);
			const value = field.slice(eqIndex + 1);

			if (!key) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Empty field key: ${field}`,
						userMessage: `Empty field key in: "${field}"`,
					}),
				);
			}

			result[key] = value;
		}

		return result;
	});
}

/**
 * Parse header arguments into an object.
 * Headers are in the format "Key: Value".
 */
export function parseHeadersEffect(
	headers: string[],
): Effect.Effect<Record<string, string>, ValidationError, never> {
	return Effect.gen(function* () {
		const result: Record<string, string> = {};

		for (const header of headers) {
			const colonIndex = header.indexOf(":");
			if (colonIndex === -1) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Invalid header format: ${header}`,
						userMessage: `Invalid header format: "${header}". Expected "Key: Value".`,
					}),
				);
			}

			const key = header.slice(0, colonIndex).trim();
			const value = header.slice(colonIndex + 1).trim();

			if (!key) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Empty header key: ${header}`,
						userMessage: `Empty header key in: "${header}"`,
					}),
				);
			}

			result[key] = value;
		}

		return result;
	});
}

/**
 * Read JSON body from file.
 */
export function readBodyFromFileEffect(
	filePath: string,
): Effect.Effect<string, ValidationError, FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;

		const exists = yield* fileExists(filePath);
		if (!exists) {
			return yield* Effect.fail(
				new ValidationError({
					message: `File not found: ${filePath}`,
					userMessage: `File not found: ${filePath}`,
				}),
			);
		}

		const content = yield* fs.readFileString(filePath).pipe(
			Effect.mapError(
				(error) =>
					new ValidationError({
						message: `Failed to read file: ${error.message}`,
						userMessage: `Could not read file: ${filePath}`,
					}),
			),
		);

		// Validate it's valid JSON
		try {
			JSON.parse(content);
		} catch {
			return yield* Effect.fail(
				new ValidationError({
					message: `Invalid JSON in file: ${filePath}`,
					userMessage: `File does not contain valid JSON: ${filePath}`,
				}),
			);
		}

		return content;
	});
}

/**
 * Build full URL from endpoint using the current environment.
 */
function buildUrlEffect(
	endpoint: string,
): Effect.Effect<string, CliError, FileSystem> {
	return Effect.gen(function* () {
		// Reject full URLs - only relative paths are allowed
		if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Full URLs are not allowed",
					userMessage:
						"Only relative endpoints are allowed (e.g., /v1/domains). Full URLs are not permitted.",
				}),
			);
		}

		// Get base URL from environment
		const env: Environment = yield* envGetEffect();
		const baseUrl = getApiUrl(env);

		// Ensure endpoint starts with /
		const normalizedEndpoint = endpoint.startsWith("/")
			? endpoint
			: `/${endpoint}`;

		return `${baseUrl}${normalizedEndpoint}`;
	});
}

/**
 * Make an authenticated request to the GoDaddy API.
 */
export function apiRequestEffect(
	options: ApiRequestOptions,
): Effect.Effect<ApiResponse, CliError, FileSystem | Keychain | Fetch> {
	return Effect.gen(function* () {
		const {
			endpoint,
			method = "GET",
			fields,
			body,
			headers = {},
			debug,
		} = options;

		// Get access token with expiry info
		const tokenInfo = yield* getTokenInfoEffect().pipe(
			Effect.mapError(
				(err) =>
					new AuthenticationError({
						message: `Failed to access token from keychain: ${err.message}`,
						userMessage:
							"Unable to access secure credentials. Unlock your keychain and try again.",
					}),
			),
		);

		if (!tokenInfo) {
			return yield* Effect.fail(
				new AuthenticationError({
					message: "No valid access token found",
					userMessage: "Not authenticated. Run 'godaddy auth login' first.",
				}),
			);
		}

		// Check if token is about to expire
		if (tokenInfo.expiresInSeconds < TOKEN_EXPIRY_BUFFER_SECONDS) {
			return yield* Effect.fail(
				new AuthenticationError({
					message: "Access token is about to expire",
					userMessage: `Token expires in ${tokenInfo.expiresInSeconds}s. Run 'godaddy auth login' to refresh.`,
				}),
			);
		}

		const accessToken = tokenInfo.accessToken;

		// Build URL
		const url = yield* buildUrlEffect(endpoint);

		// Build headers
		const requestHeaders: Record<string, string> = {
			Authorization: `Bearer ${accessToken}`,
			"X-Request-ID": uuid(),
			...headers,
		};

		// Build body
		let requestBody: string | undefined;
		if (body) {
			requestBody = body;
			if (!requestHeaders["Content-Type"]) {
				requestHeaders["Content-Type"] = "application/json";
			}
		} else if (fields && Object.keys(fields).length > 0) {
			requestBody = JSON.stringify(fields);
			if (!requestHeaders["Content-Type"]) {
				requestHeaders["Content-Type"] = "application/json";
			}
		}

		if (debug) {
			console.error(`> ${method} ${url}`);
			const sanitizedRequestHeaders = sanitizeHeaders(requestHeaders);
			for (const [key, value] of Object.entries(sanitizedRequestHeaders)) {
				console.error(`> ${key}: ${value}`);
			}
			if (requestBody) {
				console.error(`> Body: ${redactSensitiveBodyFields(requestBody)}`);
			}
			console.error("");
		}

		// Get the HTTP client from the service context
		const fetch = yield* Fetch;

		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(url, {
					method,
					headers: requestHeaders,
					body: requestBody,
				}),
			catch: (err) =>
				new NetworkError({
					message: `Network request failed: ${err instanceof Error ? err.message : String(err)}`,
					userMessage:
						"Network request failed. Check your connection and try again.",
				}),
		});

		// Parse response headers
		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		if (debug) {
			console.error(`< ${response.status} ${response.statusText}`);
			const sanitizedResponseHeaders = sanitizeHeaders(responseHeaders);
			for (const [key, value] of Object.entries(sanitizedResponseHeaders)) {
				console.error(`< ${key}: ${value}`);
			}
			console.error("");
		}

		// Parse response body
		let data: unknown;
		const contentType = response.headers.get("content-type") || "";
		if (contentType.includes("application/json")) {
			const text = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: (err) =>
					new NetworkError({
						message: `Failed to read response body: ${err}`,
						userMessage: "Failed to read API response.",
					}),
			});
			if (text) {
				try {
					data = JSON.parse(text);
				} catch {
					data = text;
				}
			}
		} else {
			data = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: (err) =>
					new NetworkError({
						message: `Failed to read response body: ${err}`,
						userMessage: "Failed to read API response.",
					}),
			});
		}

		// Check for error status codes
		if (!response.ok) {
			// Internal message includes the raw server payload for debugging;
			// userMessage is a safe, generic description shown to users/agents.
			const internalDetail =
				typeof data === "object" && data !== null
					? JSON.stringify(data)
					: String(data || response.statusText);

			// Handle 401 Unauthorized specifically - token may be revoked or invalid
			if (response.status === 401) {
				return yield* Effect.fail(
					new AuthenticationError({
						message: `Authentication failed (401): ${internalDetail}`,
						userMessage:
							"Your session has expired or is invalid. Run 'godaddy auth login' to re-authenticate.",
					}),
				);
			}

			// Handle 403 Forbidden - insufficient permissions
			if (response.status === 403) {
				return yield* Effect.fail(
					new AuthenticationError({
						message: `Access denied (403): ${internalDetail}`,
						userMessage:
							"You don't have permission to access this resource. Check your account permissions.",
					}),
				);
			}

			return yield* Effect.fail(
				new NetworkError({
					message: `API error (${response.status}): ${internalDetail}`,
					userMessage: `API request failed with status ${response.status}: ${response.statusText}`,
				}),
			);
		}

		return {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
			data,
		};
	});
}
