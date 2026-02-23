import * as NodeContext from "@effect/platform-node/NodeContext";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { NodeLiveLayer } from "../../src/effect/runtime";

/**
 * Full test layer: platform services (FileSystem, Path, Terminal) + custom services (Keychain, Browser, Fetch).
 */
const TestLayer = Layer.merge(NodeContext.layer, NodeLiveLayer);

/**
 * Run an Effect with the full test layer.
 * On failure the **original tagged error** is thrown (not a FiberFailure wrapper).
 */
export function runEffect<A>(
	effect: Effect.Effect<A, unknown, unknown>,
): Promise<A> {
	return Effect.runPromise(
		effect.pipe(
			Effect.provide(TestLayer),
		) as Effect.Effect<A, never, never>,
	);
}

/**
 * Run an Effect and return an Exit so tests can pattern-match success/failure.
 */
export function runEffectExit<A, E>(
	effect: Effect.Effect<A, E, unknown>,
): Promise<Exit.Exit<A, E>> {
	return Effect.runPromise(
		Effect.exit(
			effect.pipe(
				Effect.provide(TestLayer),
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
