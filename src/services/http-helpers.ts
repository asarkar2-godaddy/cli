/**
 * Shared HTTP helpers for API requests
 */

import * as Effect from "effect/Effect";
import { v7 as uuid } from "uuid";
import { type Environment, envGetEffect, getApiUrl } from "../core/environment";
import { ConfigurationError } from "../effect/errors";
import type { FileSystem } from "@effect/platform/FileSystem";

/**
 * Resolve the API base URL from environment variables or the active environment.
 * Pure function — no caching. The cost of envGetEffect + getApiUrl is negligible.
 */
export function initApiBaseUrlEffect(): Effect.Effect<
	string,
	ConfigurationError,
	FileSystem
> {
	return Effect.gen(function* () {
		if (process.env.APPLICATIONS_GRAPHQL_URL) {
			return process.env.APPLICATIONS_GRAPHQL_URL;
		}

		const env: Environment = yield* envGetEffect();
		return `${getApiUrl(env)}/v1/apps/app-registry-subgraph`;
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
