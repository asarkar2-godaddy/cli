import * as HelpDoc from "@effect/cli/HelpDoc";
import type { ValidationError as EffectValidationError } from "@effect/cli/ValidationError";
import {
	AuthenticationError,
	CliError,
	ConfigurationError,
	NetworkError,
	ValidationError,
} from "../../shared/types";

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

function fromCliError(error: CliError): AgentErrorDetails {
	if (error instanceof ValidationError) {
		return {
			message: error.userMessage || error.message,
			code: "VALIDATION_ERROR",
			fix: "Review command arguments and try again with valid values.",
		};
	}

	if (error instanceof AuthenticationError) {
		return {
			message: error.userMessage || "Authentication required",
			code: "AUTH_REQUIRED",
			fix: "Run: godaddy auth login",
		};
	}

	if (error instanceof ConfigurationError) {
		return {
			message: error.userMessage || error.message,
			code: "CONFIG_ERROR",
			fix: "Check your config with: godaddy env info [environment]",
		};
	}

	if (error instanceof NetworkError) {
		return {
			message: error.userMessage || error.message,
			code: "NETWORK_ERROR",
			fix: "Verify environment connectivity with: godaddy env get and retry.",
		};
	}

	return {
		message: error.userMessage || error.message,
		code: error.code || "UNEXPECTED_ERROR",
		fix: "Run: godaddy for command discovery.",
	};
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

export function mapRuntimeError(error: unknown): AgentErrorDetails {
	if (error instanceof CliError) {
		return fromCliError(error);
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

export function mapLeftoverTokens(
	leftover: ReadonlyArray<string>,
): AgentErrorDetails {
	if (
		leftover.some(
			(token) => token === "--output" || token.startsWith("--output="),
		)
	) {
		return {
			message: `Unsupported option: ${leftover.join(" ")}`,
			code: "UNSUPPORTED_OPTION",
			fix: "Remove --output; all commands now emit JSON envelopes.",
		};
	}

	const optionToken = leftover.find((token) => token.startsWith("-"));
	if (optionToken) {
		return {
			message: `Unsupported option: ${optionToken}`,
			code: "VALIDATION_ERROR",
			fix: "Remove unsupported options and rerun the command.",
		};
	}

	return {
		message: `Unexpected trailing arguments: ${leftover.join(" ")}`,
		code: "COMMAND_NOT_FOUND",
		fix: "Run: godaddy",
	};
}
