import * as Exit from "effect/Exit";
import { HttpResponse, graphql } from "msw";
import { describe, expect, test } from "vitest";
import { getApplicationEffect } from "../../src/services/applications";
import { server } from "../setup/msw-server";
import { withNoAuth, withValidAuth } from "../setup/test-utils";
import { extractFailure, runEffectExit } from "../setup/effect-test-utils";

describe("GraphQL Error Handling", () => {
	test("handles authentication error", async () => {
		withNoAuth();

		const exit = await runEffectExit(
			getApplicationEffect("test-app-1", { accessToken: null }),
		);
		const err = extractFailure(exit) as { message: string };
		expect(err.message).toContain("Access token is required");
	});

	test("handles validation errors", async () => {
		withValidAuth();

		// Override handler to return validation error
		server.use(
			graphql.operation(() => {
				return HttpResponse.json(
					{
						data: null,
						errors: [
							{
								message: "Validation failed",
								extensions: {
									code: "VALIDATION_ERROR",
									fieldErrors: {
										name: ["Name is required"],
									},
								},
							},
						],
					},
					{ status: 200 },
				);
			}),
		);

		const exit = await runEffectExit(
			getApplicationEffect("", { accessToken: "test-token-123" }),
		);
		const err = extractFailure(exit) as { message: string };
		expect(err.message).toContain("Validation failed");
	});

	test("handles server errors", async () => {
		withValidAuth();

		server.use(
			graphql.operation(() => {
				return HttpResponse.json(
					{
						data: null,
						errors: [{ message: "Internal server error" }],
					},
					{ status: 200 },
				);
			}),
		);

		const exit = await runEffectExit(
			getApplicationEffect("test-app-1", { accessToken: "test-token-123" }),
		);
		const err = extractFailure(exit) as { message: string };
		expect(err.message).toContain("Internal server error");
	});

	test("handles network errors", async () => {
		withValidAuth();

		server.use(
			graphql.operation(() => {
				return HttpResponse.error();
			}),
		);

		const exit = await runEffectExit(
			getApplicationEffect("test-app-1", { accessToken: "test-token-123" }),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});
});
