import type { Fetch } from "@effect/platform/FetchHttpClient";
import type { FileSystem } from "@effect/platform/FileSystem";
import * as Effect from "effect/Effect";
import {
	AuthenticationError,
	type ConfigurationError,
	type NetworkError,
	type ValidationError,
} from "../effect/errors";
import type { Keychain } from "../effect/services/keychain";
import { getWebhookEventsTypesEffect } from "../services/webhook-events";
import { getFromKeychainEffect } from "./auth";

// Type definitions for core webhook functions
export interface WebhookEvent {
	eventType: string;
	description: string;
}

/**
 * Get list of available webhook event types
 */
export function webhookEventsEffect(): Effect.Effect<
	WebhookEvent[],
	AuthenticationError | NetworkError | ConfigurationError | ValidationError,
	FileSystem | Keychain | Fetch
> {
	return Effect.gen(function* () {
		const accessToken = yield* getFromKeychainEffect("token");

		if (!accessToken) {
			return yield* new AuthenticationError({
				message: "Not authenticated",
				userMessage: "Please run 'godaddy auth login' first",
			});
		}

		const result = yield* getWebhookEventsTypesEffect({ accessToken });

		const events: WebhookEvent[] = result.events.map((event) => ({
			eventType: event.eventType,
			description: event.description,
		}));

		return events;
	});
}
