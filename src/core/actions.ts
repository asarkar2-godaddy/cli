/**
 * Core actions functionality
 */

import * as Effect from "effect/Effect";
import {
	type CmdResult,
	ConfigurationError,
	ValidationError,
} from "../shared/types";

// Available actions list
const AVAILABLE_ACTIONS = [
	"location.address.verify",
	"commerce.taxes.calculate",
	"commerce.shipping-rates.calculate",
	"commerce.price-adjustment.apply",
	"commerce.price-adjustment.list",
	"notifications.email.send",
	"commerce.payment.get",
	"commerce.payment.cancel",
	"commerce.payment.refund",
	"commerce.payment.process",
	"commerce.payment.auth",
];

// Action interface definitions
interface ActionInterface {
	name: string;
	description: string;
	requestSchema: object;
	responseSchema: object;
	examples?: {
		request: object;
		response: object;
	};
}

// Import the action interfaces from the CLI command
import { ACTION_INTERFACES } from "../cli/commands/actions";

/**
 * Get list of all available actions
 */
async function actionsListPromise(): Promise<CmdResult<string[]>> {
	try {
		return {
			success: true,
			data: AVAILABLE_ACTIONS,
		};
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof ConfigurationError
					? error
					: new ConfigurationError(
							error instanceof Error
								? error.message
								: "Failed to get actions list",
							"Failed to get actions list",
						),
		};
	}
}

/**
 * Get detailed interface information for a specific action
 */
async function actionsDescribePromise(
	actionName: string,
): Promise<CmdResult<ActionInterface>> {
	try {
		if (!AVAILABLE_ACTIONS.includes(actionName)) {
			return {
				success: false,
				error: new ValidationError(
					`Action '${actionName}' not found. Available actions: ${AVAILABLE_ACTIONS.join(", ")}`,
					`Action '${actionName}' not found. Run 'godaddy actions list' to discover valid actions.`,
				),
			};
		}

		const actionInterface = ACTION_INTERFACES[actionName];

		if (!actionInterface) {
			return {
				success: false,
				error: new ValidationError(
					`Interface definition not available for action '${actionName}'`,
					`Action '${actionName}' does not have an interface definition.`,
				),
			};
		}

		return {
			success: true,
			data: actionInterface,
		};
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof ConfigurationError
					? error
					: new ConfigurationError(
							error instanceof Error
								? error.message
								: "Failed to describe action",
							"Failed to describe action",
						),
		};
	}
}

export function actionsListEffect(...args: Parameters<typeof actionsListPromise>): Effect.Effect<Awaited<ReturnType<typeof actionsListPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => actionsListPromise(...args),
		catch: (error) => error,
	});
}

export function actionsDescribeEffect(...args: Parameters<typeof actionsDescribePromise>): Effect.Effect<Awaited<ReturnType<typeof actionsDescribePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => actionsDescribePromise(...args),
		catch: (error) => error,
	});
}

export function actionsList(
	...args: Parameters<typeof actionsListPromise>
): Promise<Awaited<ReturnType<typeof actionsListPromise>>> {
	return Effect.runPromise(actionsListEffect(...args));
}

export function actionsDescribe(
	...args: Parameters<typeof actionsDescribePromise>
): Promise<Awaited<ReturnType<typeof actionsDescribePromise>>> {
	return Effect.runPromise(actionsDescribeEffect(...args));
}
