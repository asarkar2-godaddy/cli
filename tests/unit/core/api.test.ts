import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	apiRequest,
	parseFields,
	parseHeaders,
	readBodyFromFile,
} from "../../../src/core/api";
import { mockKeytar, mockValidToken } from "../../setup/system-mocks";

describe("API Core Functions", () => {
	beforeEach(() => {
		mockValidToken();
		process.env.GODADDY_API_BASE_URL = "";
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		process.env.GODADDY_API_BASE_URL = "";
	});

	describe("apiRequest", () => {
		test("returns auth error when secure credential storage is unavailable", async () => {
			mockKeytar.getPassword.mockRejectedValueOnce(new Error("Keychain locked"));

			const result = await apiRequest({ endpoint: "/v1/domains" });

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe("AUTH_ERROR");
			expect(result.error?.userMessage).toContain(
				"Unable to access secure credentials",
			);
			expect(fetch).not.toHaveBeenCalled();
		});

		test("returns validation error for full URL endpoints", async () => {
			const result = await apiRequest({
				endpoint: "https://api.godaddy.com/v1/domains",
			});

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe("VALIDATION_ERROR");
			expect(result.error?.userMessage).toContain("Only relative endpoints");
			expect(fetch).not.toHaveBeenCalled();
		});

		test("makes authenticated request and returns parsed JSON", async () => {
			vi.mocked(fetch).mockResolvedValueOnce(
				new Response(JSON.stringify({ shopperId: "12345" }), {
					status: 200,
					headers: {
						"content-type": "application/json",
						"x-request-id": "resp-123",
					},
				}),
			);

			const result = await apiRequest({ endpoint: "/v1/shoppers/me" });

			expect(result.success).toBe(true);
			expect(result.data?.status).toBe(200);
			expect(result.data?.data).toEqual({ shopperId: "12345" });
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(fetch).toHaveBeenCalledWith(
				"https://api.ote-godaddy.com/v1/shoppers/me",
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						Authorization: "Bearer test-token-123",
						"X-Request-ID": expect.any(String),
					}),
				}),
			);
		});

		test("returns auth error on 401 response", async () => {
			vi.mocked(fetch).mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "Unauthorized" }), {
					status: 401,
					headers: { "content-type": "application/json" },
				}),
			);

			const result = await apiRequest({ endpoint: "/v1/shoppers/me" });

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe("AUTH_ERROR");
			expect(result.error?.userMessage).toContain("re-authenticate");
		});
	});

	describe("parseFields", () => {
		test("parses single field correctly", () => {
			const result = parseFields(["name=John"]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ name: "John" });
		});

		test("parses multiple fields correctly", () => {
			const result = parseFields(["name=John", "age=30", "city=NYC"]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ name: "John", age: "30", city: "NYC" });
		});

		test("handles values with equals signs", () => {
			const result = parseFields(["query=a=b&c=d"]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ query: "a=b&c=d" });
		});

		test("handles empty value", () => {
			const result = parseFields(["key="]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ key: "" });
		});

		test("returns error for missing equals sign", () => {
			const result = parseFields(["invalidfield"]);
			expect(result.success).toBe(false);
			expect(result.error?.userMessage).toContain("Invalid field format");
		});

		test("returns error for empty key", () => {
			const result = parseFields(["=value"]);
			expect(result.success).toBe(false);
			expect(result.error?.userMessage).toContain("Empty field key");
		});

		test("handles empty array", () => {
			const result = parseFields([]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({});
		});
	});

	describe("parseHeaders", () => {
		test("parses single header correctly", () => {
			const result = parseHeaders(["Content-Type: application/json"]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ "Content-Type": "application/json" });
		});

		test("parses multiple headers correctly", () => {
			const result = parseHeaders([
				"Content-Type: application/json",
				"X-Custom: value",
				"Accept: */*",
			]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				"Content-Type": "application/json",
				"X-Custom": "value",
				Accept: "*/*",
			});
		});

		test("handles header values with colons", () => {
			const result = parseHeaders(["X-Time: 12:30:00"]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ "X-Time": "12:30:00" });
		});

		test("trims whitespace from key and value", () => {
			const result = parseHeaders(["  Content-Type  :  application/json  "]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ "Content-Type": "application/json" });
		});

		test("returns error for missing colon", () => {
			const result = parseHeaders(["InvalidHeader"]);
			expect(result.success).toBe(false);
			expect(result.error?.userMessage).toContain("Invalid header format");
		});

		test("returns error for empty key", () => {
			const result = parseHeaders([": value"]);
			expect(result.success).toBe(false);
			expect(result.error?.userMessage).toContain("Empty header key");
		});

		test("handles empty array", () => {
			const result = parseHeaders([]);
			expect(result.success).toBe(true);
			expect(result.data).toEqual({});
		});
	});

	describe("readBodyFromFile", () => {
		test("returns error for non-existent file", () => {
			const result = readBodyFromFile("/non/existent/file.json");
			expect(result.success).toBe(false);
			expect(result.error?.userMessage).toContain("File not found");
		});
	});
});
