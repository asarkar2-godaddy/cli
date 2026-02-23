import * as Effect from "effect/Effect";
import { webhookEventsEffect } from "../../core/webhooks";
import { mapRuntimeError } from "../agent/errors";
import { nextActionsFor } from "../agent/next-actions";
import {
	commandIds,
	findRegistryNodeById,
	registryNodeToResult,
} from "../agent/registry";
import { currentCommandString, emitError, emitSuccess } from "../agent/respond";
import { truncateList } from "../agent/truncation";
import { Command } from "../command-model";

function emitWebhookError(error: unknown): void {
	const mapped = mapRuntimeError(error);
	emitError(
		currentCommandString(),
		{ message: mapped.message, code: mapped.code },
		mapped.fix,
		nextActionsFor(commandIds.webhookGroup),
	);
}

export function createWebhookCommand(): Command {
	const webhook = new Command("webhook").description(
		"Manage webhook integrations",
	);

	webhook.action(() =>
		Effect.sync(() => {
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
		}),
	);

	webhook
		.command("events")
		.description("List available webhook event types")
		.action(() =>
			Effect.gen(function* () {
				const events = yield* webhookEventsEffect();
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
			}).pipe(
				Effect.catchAll((error) => Effect.sync(() => emitWebhookError(error))),
			),
		);

	return webhook;
}
