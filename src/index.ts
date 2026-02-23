#!/usr/bin/env node

/**
 * Main entry point for the GoDaddy CLI (@effect/cli native).
 *
 * All output goes through the EnvelopeWriter service.
 * Errors are caught by the centralized boundary in cli-entry.ts.
 */

// Side-effect import: cli-entry executes at the module level
import "./cli-entry";

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
