import * as Effect from "effect/Effect";
import {
	authLoginEffect,
	authLogoutEffect,
	authStatusEffect,
} from "../../core/auth";
import { envGetEffect } from "../../core/environment";
import { mapRuntimeError } from "../agent/errors";
import { nextActionsFor } from "../agent/next-actions";
import {
	commandIds,
	findRegistryNodeById,
	registryNodeToResult,
} from "../agent/registry";
import {
	currentCommandString,
	emitError,
	emitSuccess,
	unwrapResult,
} from "../agent/respond";
import { Command } from "../command-model";

function emitAuthError(error: unknown): void {
	const mapped = mapRuntimeError(error);
	emitError(
		currentCommandString(),
		{ message: mapped.message, code: mapped.code },
		mapped.fix,
		nextActionsFor(commandIds.authGroup),
	);
}

export function createAuthCommand(): Command {
	const auth = new Command("auth").description(
		"Manage authentication with GoDaddy Developer Platform",
	);

	auth.action(() =>
		Effect.sync(() => {
			const node = findRegistryNodeById(commandIds.authGroup);
			if (!node) {
				const mapped = mapRuntimeError(
					new Error("Auth command registry metadata is missing"),
				);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.root),
				);
				return;
			}

			emitSuccess(
				currentCommandString(),
				registryNodeToResult(node),
				nextActionsFor(commandIds.authGroup),
			);
		}),
	);

	auth
		.command("login")
		.description("Login to GoDaddy Developer Platform")
		.action(() =>
			Effect.gen(function* () {
				const loginResult = unwrapResult(
					yield* authLoginEffect(),
					"Authentication failed",
				);
				const environmentResult = yield* envGetEffect();
				const environment = environmentResult.success
					? String(environmentResult.data)
					: "unknown";

				emitSuccess(
					currentCommandString(),
					{
						authenticated: loginResult.success,
						environment,
						expires_at: loginResult.expiresAt?.toISOString(),
					},
					nextActionsFor(commandIds.authLogin),
				);
			}).pipe(Effect.catchAll((error) => Effect.sync(() => emitAuthError(error)))),
		);

	auth
		.command("logout")
		.description("Logout and clear stored credentials")
		.action(() =>
			Effect.gen(function* () {
				unwrapResult(yield* authLogoutEffect(), "Logout failed");
				const environmentResult = yield* envGetEffect();
				const environment = environmentResult.success
					? String(environmentResult.data)
					: "unknown";

				emitSuccess(
					currentCommandString(),
					{ authenticated: false, environment },
					nextActionsFor(commandIds.authLogout),
				);
			}).pipe(Effect.catchAll((error) => Effect.sync(() => emitAuthError(error)))),
		);

	auth
		.command("status")
		.description("Check authentication status")
		.action(() =>
			Effect.gen(function* () {
				const status = unwrapResult(
					yield* authStatusEffect(),
					"Failed to check authentication status",
				);

				emitSuccess(
					currentCommandString(),
					{
						authenticated: status.authenticated,
						has_token: status.hasToken,
						token_expiry: status.tokenExpiry?.toISOString(),
						environment: status.environment,
					},
					nextActionsFor(commandIds.authStatus, {
						authenticated: status.authenticated,
					}),
				);
			}).pipe(Effect.catchAll((error) => Effect.sync(() => emitAuthError(error)))),
		);

	return auth;
}
