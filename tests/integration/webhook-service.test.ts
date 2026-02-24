import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";
import { getWebhookEventsTypesEffect } from "../../src/services/webhook-events";
import {
	extractFailure,
	runEffect,
	runEffectExit,
} from "../setup/effect-test-utils";
import { webhookEventTypesFixture } from "../setup/fixtures/webhook-fixtures";
import { withValidAuth } from "../setup/test-utils";

describe("webhook service", () => {
	describe("getWebhookEventsTypes", () => {
		it("should return webhook event types with valid auth", async () => {
			withValidAuth();

			const result = await runEffect(
				getWebhookEventsTypesEffect({ accessToken: "test-token-123" }),
			);

			expect(result).toEqual(webhookEventTypesFixture);
			expect(result.events).toHaveLength(8);
			expect(result.events[0]).toEqual({
				eventType: "application.created",
				description: "Triggered when a new application is created",
			});
		});

		it("should throw error with null access token", async () => {
			const exit = await runEffectExit(
				getWebhookEventsTypesEffect({ accessToken: null }),
			);
			const err = extractFailure(exit) as { message: string };
			expect(err.message).toContain("Access token is required");
		});

		it("should throw authentication error with invalid token", async () => {
			const exit = await runEffectExit(
				getWebhookEventsTypesEffect({ accessToken: "invalid-token" }),
			);
			const err = extractFailure(exit) as { message: string };
			expect(err.message).toContain("Authentication failed");
		});

		it("should return specific event types in response", async () => {
			withValidAuth();

			const result = await runEffect(
				getWebhookEventsTypesEffect({ accessToken: "test-token-123" }),
			);

			const eventTypes = result.events.map((event) => event.eventType);
			expect(eventTypes).toContain("application.created");
			expect(eventTypes).toContain("application.updated");
			expect(eventTypes).toContain("application.deleted");
			expect(eventTypes).toContain("application.enabled");
			expect(eventTypes).toContain("application.disabled");
			expect(eventTypes).toContain("application.archived");
			expect(eventTypes).toContain("release.created");
			expect(eventTypes).toContain("release.deployed");
		});

		it("should include descriptions for each event type", async () => {
			withValidAuth();

			const result = await runEffect(
				getWebhookEventsTypesEffect({ accessToken: "test-token-123" }),
			);

			for (const event of result.events) {
				expect(event.description).toBeTruthy();
				expect(typeof event.description).toBe("string");
				expect(event.description.length).toBeGreaterThan(0);
			}
		});
	});
});
