/**
 * Core actions functionality
 */

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
export async function actionsList(): Promise<CmdResult<string[]>> {
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
export async function actionsDescribe(
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
