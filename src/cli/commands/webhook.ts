import { Command } from "../command-model";
import { webhookEvents } from "../../core/webhooks";
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
import { truncateList } from "../agent/truncation";

export function createWebhookCommand(): Command {
	const webhook = new Command("webhook").description(
		"Manage webhook integrations",
	);

	webhook.action(async () => {
		const node = findRegistryNodeById(commandIds.webhookGroup);
		if (!node) {
			const mapped = mapRuntimeError(
				new Error("Webhook command registry metadata is missing"),
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
			nextActionsFor(commandIds.webhookGroup),
		);
	});

	webhook
		.command("events")
		.description("List available webhook event types")
		.action(async () => {
			try {
				const events = unwrapResult(
					await webhookEvents(),
					"Failed to get webhook events",
				);
				const truncated = truncateList(events, "webhook-events");

				emitSuccess(
					currentCommandString(),
					{
						events: truncated.items,
						total: truncated.metadata.total,
						shown: truncated.metadata.shown,
						truncated: truncated.metadata.truncated,
						full_output: truncated.metadata.full_output,
					},
					nextActionsFor(commandIds.webhookEvents),
				);
			} catch (error) {
				const mapped = mapRuntimeError(error);
				emitError(
					currentCommandString(),
					{ message: mapped.message, code: mapped.code },
					mapped.fix,
					nextActionsFor(commandIds.webhookGroup),
				);
			}
		});

	return webhook;
}
