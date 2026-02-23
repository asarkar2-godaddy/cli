import { describe, expect, test } from "vitest";
import { createApiCommand, extractPath } from "../../../src/cli/commands/api";

describe("API Command - extractPath", () => {
	const testData = {
		shopperId: "12345",
		customer: {
			email: "test@example.com",
			name: "John Doe",
			address: {
				city: "Phoenix",
				state: "AZ",
			},
		},
		domains: [
			{ domain: "example.com", status: "active" },
			{ domain: "test.com", status: "pending" },
		],
		tags: ["web", "api", "test"],
		"content-type": "application/json",
		headers: {
			"x-request-id": "abc-123",
			"x-correlation-id": "def-456",
		},
	};

	describe("basic property access", () => {
		test("returns full object for empty path", () => {
			expect(extractPath(testData, "")).toEqual(testData);
		});

		test("returns full object for dot path", () => {
			expect(extractPath(testData, ".")).toEqual(testData);
		});

		test("extracts top-level property with leading dot", () => {
			expect(extractPath(testData, ".shopperId")).toBe("12345");
		});

		test("extracts top-level property without leading dot", () => {
			expect(extractPath(testData, "shopperId")).toBe("12345");
		});
	});

	describe("nested property access", () => {
		test("extracts nested property", () => {
			expect(extractPath(testData, ".customer.email")).toBe("test@example.com");
		});

		test("extracts deeply nested property", () => {
			expect(extractPath(testData, ".customer.address.city")).toBe("Phoenix");
		});
	});

	describe("hyphenated property access", () => {
		test("extracts top-level hyphenated property", () => {
			expect(extractPath(testData, ".content-type")).toBe("application/json");
		});

		test("extracts nested hyphenated property", () => {
			expect(extractPath(testData, ".headers.x-request-id")).toBe("abc-123");
		});

		test("extracts another nested hyphenated property", () => {
			expect(extractPath(testData, ".headers.x-correlation-id")).toBe(
				"def-456",
			);
		});
	});

	describe("array access", () => {
		test("extracts array element by index", () => {
			expect(extractPath(testData, ".tags[0]")).toBe("web");
		});

		test("extracts last array element", () => {
			expect(extractPath(testData, ".tags[2]")).toBe("test");
		});

		test("extracts object from array", () => {
			expect(extractPath(testData, ".domains[0]")).toEqual({
				domain: "example.com",
				status: "active",
			});
		});

		test("extracts property from array element", () => {
			expect(extractPath(testData, ".domains[0].domain")).toBe("example.com");
		});

		test("extracts property from second array element", () => {
			expect(extractPath(testData, ".domains[1].status")).toBe("pending");
		});
	});

	describe("edge cases", () => {
		test("returns undefined for non-existent property", () => {
			expect(extractPath(testData, ".nonexistent")).toBeUndefined();
		});

		test("returns undefined for out-of-bounds array index", () => {
			expect(extractPath(testData, ".tags[99]")).toBeUndefined();
		});

		test("returns undefined for nested non-existent property", () => {
			expect(extractPath(testData, ".customer.phone")).toBeUndefined();
		});

		test("handles null input", () => {
			expect(extractPath(null, ".key")).toBeUndefined();
		});

		test("handles undefined input", () => {
			expect(extractPath(undefined, ".key")).toBeUndefined();
		});
	});

	describe("error cases", () => {
		test("throws error when indexing non-array", () => {
			expect(() => extractPath(testData, ".shopperId[0]")).toThrow(
				"Cannot index non-array",
			);
		});

		test("throws error when accessing property on primitive", () => {
			expect(() => extractPath(testData, ".shopperId.length")).toThrow(
				"Cannot access property",
			);
		});
	});
});

describe("API Command - command model", () => {
	test("defines a required endpoint positional argument", () => {
		const command = createApiCommand();
		expect(command.arguments).toHaveLength(1);
		expect(command.arguments[0]).toMatchObject({
			name: "endpoint",
			required: true,
		});
	});

	test("supports repeatable field and header options", () => {
		const command = createApiCommand();
		const fieldOption = command.options.find(
			(option) => option.longName === "field",
		);
		const headerOption = command.options.find(
			(option) => option.longName === "header",
		);

		expect(fieldOption).toMatchObject({
			takesValue: true,
			multiple: true,
		});
		expect(headerOption).toMatchObject({
			takesValue: true,
			multiple: true,
		});
	});

	test("supports include flag as a boolean option", () => {
		const command = createApiCommand();
		const includeOption = command.options.find(
			(option) => option.longName === "include",
		);

		expect(includeOption).toMatchObject({
			takesValue: false,
			multiple: false,
		});
	});
});
