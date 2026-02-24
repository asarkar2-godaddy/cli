import * as HelpDoc from "@effect/cli/HelpDoc";
import type { ValidationError as EffectValidationError } from "@effect/cli/ValidationError";
import { type CliError, errorCode } from "../../effect/errors";

export interface AgentErrorDetails {
	message: string;
	code: string;
	fix: string;
}

const ANSI_ESCAPE_PATTERN = new RegExp(
	`${String.fromCharCode(27)}\\[[0-9;]*m`,
	"g",
);

function stripAnsi(value: string): string {
	return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function formatValidationMessage(error: EffectValidationError): string {
	if ("error" in error && error.error) {
		const text = stripAnsi(HelpDoc.toAnsiText(error.error)).trim();
		if (text.length > 0) {
			return text;
		}
	}

	return "Invalid command input";
}

function fromTaggedError(error: CliError): AgentErrorDetails {
	const code = errorCode(error);
	const message = error.userMessage || error.message;

	switch (error._tag) {
		case "ValidationError":
			return {
				message,
				code,
				fix: "Review command arguments and try again with valid values.",
			};
		case "AuthenticationError":
			return {
				message,
				code: "AUTH_REQUIRED",
				fix: "Run: godaddy auth login",
			};
		case "ConfigurationError":
			return {
				message,
				code,
				fix: "Check your config with: godaddy env info [environment]",
			};
		case "NetworkError":
			return {
				message,
				code,
				fix: "Verify environment connectivity with: godaddy env get and retry.",
			};
		case "SecurityError":
			return {
				message,
				code,
				fix: "Resolve security findings and rerun: godaddy application deploy <name>",
			};
	}
}

function inferFromMessage(message: string): AgentErrorDetails {
	const lower = message.toLowerCase();

	if (lower.includes("--output")) {
		return {
			message,
			code: "UNSUPPORTED_OPTION",
			fix: "Remove --output; all commands now emit JSON envelopes.",
		};
	}

	if (lower.includes("security") || lower.includes("blocked")) {
		return {
			message,
			code: "SECURITY_BLOCKED",
			fix: "Resolve security findings and rerun: godaddy application deploy <name>",
		};
	}

	if (lower.includes("not found") || lower.includes("does not exist")) {
		return {
			message,
			code: "NOT_FOUND",
			fix: "Use discovery commands such as: godaddy application list or godaddy actions list.",
		};
	}

	if (lower.includes("auth") || lower.includes("token")) {
		return {
			message,
			code: "AUTH_REQUIRED",
			fix: "Run: godaddy auth login",
		};
	}

	return {
		message,
		code: "UNEXPECTED_ERROR",
		fix: "Run: godaddy for command discovery and retry with corrected input.",
	};
}

function isTaggedError(error: unknown): error is CliError {
	return (
		typeof error === "object" &&
		error !== null &&
		"_tag" in error &&
		typeof (error as { _tag: unknown })._tag === "string" &&
		[
			"ValidationError",
			"NetworkError",
			"AuthenticationError",
			"ConfigurationError",
			"SecurityError",
		].includes((error as { _tag: string })._tag)
	);
}

export function mapRuntimeError(error: unknown): AgentErrorDetails {
	if (isTaggedError(error)) {
		return fromTaggedError(error);
	}

	if (error instanceof Error) {
		return inferFromMessage(error.message);
	}

	return {
		message: "Unknown error",
		code: "UNEXPECTED_ERROR",
		fix: "Run: godaddy for command discovery.",
	};
}

export function mapValidationError(
	error: EffectValidationError,
): AgentErrorDetails {
	const message = formatValidationMessage(error);

	if (message.includes("--output")) {
		return {
			message,
			code: "UNSUPPORTED_OPTION",
			fix: "Remove --output; all commands now emit JSON envelopes.",
		};
	}

	switch (error._tag) {
		case "CommandMismatch":
			return {
				message,
				code: "COMMAND_NOT_FOUND",
				fix: "Run: godaddy",
			};
		case "MissingFlag":
		case "MissingValue":
		case "InvalidArgument":
		case "InvalidValue":
		case "MultipleValuesDetected":
		case "NoBuiltInMatch":
		case "UnclusteredFlag":
		case "MissingSubcommand":
		case "CorrectedFlag":
			return {
				message,
				code: "VALIDATION_ERROR",
				fix: "Provide valid arguments/options shown in --help and retry.",
			};
		case "HelpRequested":
			return {
				message,
				code: "VALIDATION_ERROR",
				fix: "Use --help for command usage details.",
			};
		default:
			return {
				message,
				code: "VALIDATION_ERROR",
				fix: "Check command usage with --help and retry.",
			};
	}
}
