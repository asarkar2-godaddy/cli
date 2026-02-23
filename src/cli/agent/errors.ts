import type { CommanderError } from "commander";
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

export function mapCommanderError(error: CommanderError): AgentErrorDetails {
	if (error.code === "commander.unknownCommand") {
		return {
			message: error.message,
			code: "COMMAND_NOT_FOUND",
			fix: "Run: godaddy",
		};
	}

	if (error.code === "commander.unknownOption") {
		if (error.message.includes("--output")) {
			return {
				message: error.message,
				code: "UNSUPPORTED_OPTION",
				fix: "Remove --output; all commands now emit JSON envelopes.",
			};
		}

		return {
			message: error.message,
			code: "VALIDATION_ERROR",
			fix: "Remove unsupported options and rerun the command.",
		};
	}

	if (
		error.code === "commander.missingArgument" ||
		error.code === "commander.optionMissingArgument"
	) {
		return {
			message: error.message,
			code: "VALIDATION_ERROR",
			fix: "Provide all required arguments and options shown in --help.",
		};
	}

	if (error.code === "commander.excessArguments") {
		return {
			message: error.message,
			code: "COMMAND_NOT_FOUND",
			fix: "Run: godaddy",
		};
	}

	return {
		message: error.message,
		code: "VALIDATION_ERROR",
		fix: "Check command usage with --help and retry.",
	};
}
