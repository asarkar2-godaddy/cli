import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { NodeLiveLayer } from "../../src/effect/runtime";

/**
 * Run an Effect with the NodeLiveLayer (which uses globally-mocked keytar, fs, etc.).
 * Use this in tests that call Effect-based APIs from core modules.
 *
 * On failure the **original tagged error** is thrown (not a FiberFailure wrapper),
 * so tests can assert on `error._tag`, `error.userMessage`, etc. directly.
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

/**
 * Run an Effect and return an Exit so tests can pattern-match success/failure
 * without dealing with FiberFailure wrappers.
 */
export function runEffectExit<A, E>(
	effect: Effect.Effect<A, E, unknown>,
): Promise<Exit.Exit<A, E>> {
	return Effect.runPromise(
		Effect.exit(
			effect.pipe(
				Effect.provide(NodeLiveLayer),
			) as Effect.Effect<A, E, never>,
		),
	);
}

/**
 * Extract the typed failure from a failed Exit, or throw if the Exit is a success.
 */
export function extractFailure<A, E>(exit: Exit.Exit<A, E>): E {
	if (Exit.isSuccess(exit)) {
		throw new Error("Expected failure but got success");
	}
	const option = Cause.failureOption(exit.cause);
	if (Option.isNone(option)) {
		throw new Error(
			`Expected typed failure but got defect: ${Cause.pretty(exit.cause)}`,
		);
	}
	return option.value;
}
