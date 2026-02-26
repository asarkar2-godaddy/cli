import { existsSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	protectPayload,
	truncateList,
} from "../../../src/cli/agent/truncation";

const createdFiles = new Set<string>();

afterEach(() => {
	for (const filePath of createdFiles) {
		if (existsSync(filePath)) {
			rmSync(filePath, { force: true });
		}
	}
	createdFiles.clear();
});

function assertOwnerOnlyPermissions(filePath: string): void {
	const fileMode = statSync(filePath).mode & 0o777;
	const dirMode = statSync(dirname(filePath)).mode & 0o777;

	// Group/other permissions should be zero on POSIX systems.
	expect(fileMode & 0o077).toBe(0);
	expect(dirMode & 0o077).toBe(0);
}

describe("truncation full output", () => {
	test("writes list full_output with owner-only permissions", () => {
		const list = Array.from({ length: 51 }, (_, index) => ({
			id: index,
			value: `item-${index}`,
		}));

		const result = truncateList(list, "security-list-test");
		expect(result.metadata.truncated).toBe(true);
		expect(result.metadata.full_output).toBeDefined();

		const fullOutput = result.metadata.full_output;
		if (!fullOutput) {
			throw new Error("expected full_output path");
		}

		createdFiles.add(fullOutput);
		expect(existsSync(fullOutput)).toBe(true);

		if (process.platform !== "win32") {
			assertOwnerOnlyPermissions(fullOutput);
		}
	});

	test("writes payload full_output with owner-only permissions", () => {
		const hugeValue = "x".repeat(20_000);
		const result = protectPayload({ hugeValue }, "security-payload-test");
		expect(result.metadata?.truncated).toBe(true);
		expect(result.metadata?.full_output).toBeDefined();

		const fullOutput = result.metadata?.full_output;
		if (!fullOutput) {
			throw new Error("expected full_output path");
		}

		createdFiles.add(fullOutput);
		expect(existsSync(fullOutput)).toBe(true);

		if (process.platform !== "win32") {
			assertOwnerOnlyPermissions(fullOutput);
		}
	});
});
