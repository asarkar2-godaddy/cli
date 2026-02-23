/**
 * Shared HTTP helpers for API requests
 */

import * as Effect from "effect/Effect";
import { v7 as uuid } from "uuid";
import { type Environment, envGetEffect, getApiUrl } from "../core/environment";
import { ConfigurationError } from "../effect/errors";
import type { FileSystem } from "../effect/services/filesystem";

// Cached API base URL
let apiBaseUrl: string | null = null;

/**
 * Get or initialize the API base URL based on the environment.
 * Uses envGetEffect to determine the active environment when no override is set.
 */
export function initApiBaseUrlEffect(): Effect.Effect<
	string,
	ConfigurationError,
	FileSystem
> {
	return Effect.gen(function* () {
		if (apiBaseUrl) return apiBaseUrl;

		// Use environment variable if set, otherwise determine from active environment
		if (process.env.APPLICATIONS_GRAPHQL_URL) {
			apiBaseUrl = process.env.APPLICATIONS_GRAPHQL_URL;
		} else {
			const env: Environment = yield* envGetEffect();
			apiBaseUrl = `${getApiUrl(env)}/v1/apps/app-registry-subgraph`;
		}

		return apiBaseUrl;
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(
				"_tag" in error && error._tag === "ConfigurationError"
					? (error as ConfigurationError)
					: new ConfigurationError({
							message: `Failed to initialize API base URL: ${error}`,
							userMessage: "Could not determine API base URL",
						}),
			),
		),
	);
}

/**
 * Get standard request headers with authentication
 */
export function getRequestHeaders(accessToken: string): Record<string, string> {
	return {
		Authorization: `Bearer ${accessToken}`,
		"X-Request-ID": uuid(),
	};
}
