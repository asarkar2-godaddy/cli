import * as Effect from "effect/Effect";
import { NodeLiveLayer } from "../../src/effect/runtime";

/**
 * Run an Effect with the NodeLiveLayer (which uses globally-mocked keytar, fs, etc.).
 * Use this in tests that call Effect-based APIs from core modules.
 */
export function runEffect<A>(
	effect: Effect.Effect<A, unknown, unknown>,
): Promise<A> {
	return Effect.runPromise(
		effect.pipe(
			Effect.provide(NodeLiveLayer),
		) as Effect.Effect<A, never, never>,
	);
}
