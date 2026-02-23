#!/usr/bin/env node

import { runCli } from "./cli-entry";
import { mapRuntimeError } from "./cli/agent/errors";
import { commandIds } from "./cli/agent/registry";
import { nextActionsFor } from "./cli/agent/next-actions";
import {
	currentCommandString,
	emitError,
	hasWrittenEnvelope,
	resetEnvelopeWriter,
} from "./cli/agent/respond";

/**
 * Main entry point for the GoDaddy CLI
 */
async function main(): Promise<void> {
	resetEnvelopeWriter();

	try {
		await runCli(process.argv.slice(2));
	} catch (error) {
		if (!hasWrittenEnvelope()) {
			const mapped = mapRuntimeError(error);
			emitError(
				currentCommandString(),
				{ message: mapped.message, code: mapped.code },
				mapped.fix,
				nextActionsFor(commandIds.root),
			);
		}
	}
}

// Restore cursor visibility on exit or signals
const restoreCursor = () => {
	const terminal = process.stderr.isTTY
		? process.stderr
		: process.stdout.isTTY
			? process.stdout
			: undefined;
	terminal?.write("\u001B[?25h");
};

process.on("exit", restoreCursor);
process.on("SIGINT", () => {
	restoreCursor();
	process.exit(130);
});
process.on("SIGTERM", () => {
	restoreCursor();
	process.exit(143);
});

// Start the application
main().catch((error) => {
	if (!hasWrittenEnvelope()) {
		const mapped = mapRuntimeError(error);
		emitError(
			currentCommandString(),
			{ message: mapped.message, code: mapped.code },
			mapped.fix,
			nextActionsFor(commandIds.root),
		);
	}
});
