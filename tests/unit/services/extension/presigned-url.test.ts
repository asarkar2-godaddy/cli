import { getUploadTargetEffect } from "@/services/extension/presigned-url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	extractFailure,
	runEffect,
	runEffectExit,
} from "../../../setup/effect-test-utils";

// Mock logger
vi.mock("@/services/logger", () => ({
	getLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

// Mock the graphql-request module
vi.mock("graphql-request", () => ({
	request: vi.fn(),
}));

// Mock environment
vi.mock("@/core/environment", () => ({
	getActiveEnvironment: vi.fn().mockResolvedValue("dev"),
	getApiUrl: vi.fn().mockReturnValue("https://api.dev.example.com"),
	envGetEffect: vi.fn().mockReturnValue({
		pipe: () => ({ pipe: () => ({ pipe: () => "ote" }) }),
	}),
}));

// Mock http-helpers to provide a stable base URL without needing FileSystem
vi.mock("@/services/http-helpers", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	const Effect = await import("effect/Effect");
	return {
		...actual,
		initApiBaseUrlEffect: () =>
			Effect.succeed("https://api.dev.example.com/v1/apps/app-registry-subgraph"),
	};
});

describe("presigned-url service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("getUploadTarget", () => {
		it("should request presigned URL from GraphQL API", async () => {
			const { request: mockRequest } = await import("graphql-request");
			vi.mocked(mockRequest).mockResolvedValue({
				generateReleaseUploadUrl: {
					uploadId: "test-upload-id",
					url: "https://s3.example.com/presigned-url",
					key: "app/release/extension.js",
					expiresAt: "2025-11-14T16:00:00Z",
					maxSizeBytes: 10485760,
					requiredHeaders: ["content-type:application/javascript"],
				},
			});

			const result = await runEffect(
				getUploadTargetEffect(
					{
						applicationId: "app-123",
						releaseId: "release-456",
						contentType: "JS",
					},
					"test-access-token",
				),
			);

			expect(result).toEqual({
				uploadId: "test-upload-id",
				url: "https://s3.example.com/presigned-url",
				key: "app/release/extension.js",
				expiresAt: "2025-11-14T16:00:00Z",
				maxSizeBytes: 10485760,
				requiredHeaders: {
					"content-type": "application/javascript",
				},
			});
		});

		it("should default to JS content type", async () => {
			const { request: mockRequest } = await import("graphql-request");
			vi.mocked(mockRequest).mockResolvedValue({
				generateReleaseUploadUrl: {
					uploadId: "test-upload-id",
					url: "https://s3.example.com/presigned-url",
					key: "app/release/extension.js",
					expiresAt: "2025-11-14T16:00:00Z",
					maxSizeBytes: 10485760,
					requiredHeaders: [],
				},
			});

			await runEffect(
				getUploadTargetEffect(
					{
						applicationId: "app-123",
						releaseId: "release-456",
					},
					"test-access-token",
				),
			);

			expect(mockRequest).toHaveBeenCalledWith(
				expect.any(String),
				expect.anything(),
				expect.objectContaining({
					input: expect.objectContaining({
						contentType: "JS",
					}),
				}),
				expect.anything(),
			);
		});

		it("should parse multiple required headers correctly", async () => {
			const { request: mockRequest } = await import("graphql-request");
			vi.mocked(mockRequest).mockResolvedValue({
				generateReleaseUploadUrl: {
					uploadId: "test-upload-id",
					url: "https://s3.example.com/presigned-url",
					key: "app/release/extension.js",
					expiresAt: "2025-11-14T16:00:00Z",
					maxSizeBytes: 10485760,
					requiredHeaders: [
						"content-type:application/javascript",
						"x-amz-meta-upload-id:test-upload-id",
						"x-custom-header:value:with:colons",
					],
				},
			});

			const result = await runEffect(
				getUploadTargetEffect(
					{
						applicationId: "app-123",
						releaseId: "release-456",
					},
					"test-access-token",
				),
			);

			expect(result.requiredHeaders).toEqual({
				"content-type": "application/javascript",
				"x-amz-meta-upload-id": "test-upload-id",
				"x-custom-header": "value:with:colons",
			});
		});

		it("should throw error if response is empty", async () => {
			const { request: mockRequest } = await import("graphql-request");
			vi.mocked(mockRequest).mockResolvedValue({
				generateReleaseUploadUrl: null,
			});

			const exit = await runEffectExit(
				getUploadTargetEffect(
					{
						applicationId: "app-123",
						releaseId: "release-456",
					},
					"test-access-token",
				),
			);

			const err = extractFailure(exit) as { message: string };
			expect(err.message).toContain(
				"Failed to generate upload URL: empty response",
			);
		});
	});
});
