import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	emitStreamError,
	emitStreamProgress,
	emitStreamResult,
	emitStreamStart,
	emitStreamStep,
} from "../../../src/cli/agent/stream";
import {
	hasWrittenEnvelope,
	resetEnvelopeWriter,
} from "../../../src/cli/agent/respond";

describe("Deploy stream protocol", () => {
	let writes: string[] = [];

	beforeEach(() => {
		resetEnvelopeWriter();
		writes = [];
		process.exitCode = 0;
		vi.spyOn(process.stdout, "write").mockImplementation(
			((chunk: string | Uint8Array) => {
				writes.push(
					typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
				);
				return true;
			}) as typeof process.stdout.write,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("emits typed NDJSON progress events", () => {
		emitStreamStart("godaddy application deploy demo --follow");
		emitStreamStep({
			name: "scan.prebundle",
			status: "started",
			extensionName: "@demo/extension",
		});
		emitStreamProgress({
			name: "scan.prebundle",
			percent: 50,
			message: "Scanned 1/2 extension(s)",
		});

		expect(writes).toHaveLength(3);
		expect(JSON.parse(writes[0]).type).toBe("start");
		expect(JSON.parse(writes[1]).type).toBe("step");
		expect(JSON.parse(writes[1]).extension_name).toBe("@demo/extension");
		expect(JSON.parse(writes[2]).type).toBe("progress");
		expect(JSON.parse(writes[2]).percent).toBe(50);
		expect(hasWrittenEnvelope()).toBe(false);
	});

	test("emits terminal result event and marks envelope as written", () => {
		expect(hasWrittenEnvelope()).toBe(false);
		emitStreamResult(
			"godaddy application deploy demo --follow",
			{ total_extensions: 1, blocked_extensions: 0 },
			[],
		);

		const resultEvent = JSON.parse(writes[0]);
		expect(resultEvent.type).toBe("result");
		expect(resultEvent.ok).toBe(true);
		expect(hasWrittenEnvelope()).toBe(true);
	});

	test("emits terminal error event and sets exit code", () => {
		emitStreamError(
			"godaddy application deploy demo --follow",
			{ message: "blocked", code: "SECURITY_BLOCKED" },
			"Resolve findings and rerun",
			[],
		);

		const errorEvent = JSON.parse(writes[0]);
		expect(errorEvent.type).toBe("error");
		expect(errorEvent.ok).toBe(false);
		expect(errorEvent.error.code).toBe("SECURITY_BLOCKED");
		expect(process.exitCode).toBe(1);
		expect(hasWrittenEnvelope()).toBe(true);
	});
});
