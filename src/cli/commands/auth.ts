import { Command } from "../command-model";
import { envGet } from "../../core/environment";
import { mapRuntimeError } from "../agent/errors";
import {
	commandIds,
	findRegistryNodeById,
	registryNodeToResult,
} from "../agent/registry";
import { nextActionsFor } from "../agent/next-actions";
import {
	currentCommandString,
	emitError,
	emitSuccess,
	unwrapResult,
} from "../agent/respond";

async function loadAuthModule() {
	return import("../../core/auth");
}

export function createAuthCommand(): Command {
	const auth = new Command("auth").description(
		"Manage authentication with GoDaddy Developer Platform",
	);

	auth.action(async () => {
		const node = findRegistryNodeById(commandIds.authGroup);
		if (!node) {
			const mapped = mapRuntimeError(
				new Error("Auth command registry metadata is missing"),
			);
			emitError(currentCommandString(), mapped, mapped.fix, nextActionsFor(commandIds.root));
			return;
		}

		emitSuccess(
			currentCommandString(),
			registryNodeToResult(node),
			nextActionsFor(commandIds.authGroup),
		);
	});

	auth
		.command("login")
		.description("Login to GoDaddy Developer Platform")
		.action(async () => {
			try {
				const { authLogin } = await loadAuthModule();
				const loginResult = unwrapResult(
					await authLogin(),
					"Authentication failed",
				);
				const environmentResult = await envGet();
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
			} catch (error) {
				const mapped = mapRuntimeError(error);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.authGroup),
				);
			}
		});

	auth
		.command("logout")
		.description("Logout and clear stored credentials")
		.action(async () => {
			try {
				const { authLogout } = await loadAuthModule();
				unwrapResult(await authLogout(), "Logout failed");
				const environmentResult = await envGet();
				const environment = environmentResult.success
					? String(environmentResult.data)
					: "unknown";

				emitSuccess(
					currentCommandString(),
					{ authenticated: false, environment },
					nextActionsFor(commandIds.authLogout),
				);
			} catch (error) {
				const mapped = mapRuntimeError(error);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.authGroup),
				);
			}
		});

	auth
		.command("status")
		.description("Check authentication status")
		.action(async () => {
			try {
				const { authStatus } = await loadAuthModule();
				const status = unwrapResult(
					await authStatus(),
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
			} catch (error) {
				const mapped = mapRuntimeError(error);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.authGroup),
				);
			}
		});

	return auth;
}
