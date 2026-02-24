import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { describe, expect, test } from "vitest";
import {
	type CapturedEnvelope,
	EnvelopeWriter,
	makeTestEnvelopeWriter,
} from "../../../src/cli/services/envelope-writer";

/**
 * Run a program against a test EnvelopeWriter and return the captured output.
 */
function runWithCapture(
	program: Effect.Effect<void, never, EnvelopeWriter>,
): Promise<CapturedEnvelope[]> {
	return Effect.gen(function* () {
		const { service, captured } = yield* makeTestEnvelopeWriter();
		yield* program.pipe(Effect.provide(Layer.succeed(EnvelopeWriter, service)));
		return yield* Ref.get(captured);
	}).pipe(Effect.runPromise);
}

describe("Deploy stream protocol", () => {
	test("emits typed NDJSON progress events", async () => {
		const captured = await runWithCapture(
			Effect.gen(function* () {
				const writer = yield* EnvelopeWriter;
				yield* writer.emitStreamEvent({
					type: "start",
					command: "godaddy application deploy demo --follow",
					ts: new Date().toISOString(),
				});
				yield* writer.emitStreamEvent({
					type: "step",
					name: "scan.prebundle",
					status: "started",
					extension_name: "@demo/extension",
					ts: new Date().toISOString(),
				});
				yield* writer.emitStreamEvent({
					type: "progress",
					name: "scan.prebundle",
					percent: 50,
					message: "Scanned 1/2 extension(s)",
					ts: new Date().toISOString(),
				});
			}),
		);

		expect(captured).toHaveLength(3);
		const start = captured[0].value as Record<string, unknown>;
		const step = captured[1].value as Record<string, unknown>;
		const progress = captured[2].value as Record<string, unknown>;
		expect(start.type).toBe("start");
		expect(step.type).toBe("step");
		expect(step.extension_name).toBe("@demo/extension");
		expect(progress.type).toBe("progress");
		expect(progress.percent).toBe(50);
	});

	test("emits terminal result event", async () => {
		const captured = await runWithCapture(
			Effect.gen(function* () {
				const writer = yield* EnvelopeWriter;
				yield* writer.emitStreamResult(
					"godaddy application deploy demo --follow",
					{ total_extensions: 1, blocked_extensions: 0 },
					[],
				);
			}),
		);

		expect(captured).toHaveLength(1);
		const result = captured[0].value as Record<string, unknown>;
		expect(result.type).toBe("result");
		expect(result.ok).toBe(true);
	});

	test("emits terminal error event and marks written", async () => {
		const hasWritten = await Effect.gen(function* () {
			const { service, captured: _ } = yield* makeTestEnvelopeWriter();
			const layer = Layer.succeed(EnvelopeWriter, service);
			yield* Effect.gen(function* () {
				const writer = yield* EnvelopeWriter;
				yield* writer.emitStreamError(
					"godaddy application deploy demo --follow",
					{ message: "blocked", code: "SECURITY_BLOCKED" },
					"Resolve findings and rerun",
					[],
				);
			}).pipe(Effect.provide(layer));
			return yield* service.hasWritten;
		}).pipe(Effect.runPromise);

		expect(hasWritten).toBe(true);
	});
});
