/**
 * Core type definitions shared across CLI and TUI
 */

// Generic result wrapper
export interface Result<T = unknown> {
	success: boolean;
	data?: T;
	error?: Error;
}

// Command result wrapper
export interface CmdResult<T = unknown> {
	success: boolean;
	data?: T;
	error?: CliError;
}

// Error type hierarchy
export abstract class CliError extends Error {
	abstract code: string;
	userMessage: string;
	readonly originalError?: unknown;

	constructor(message: string, userMessage?: string, originalError?: unknown) {
		super(message);
		this.name = this.constructor.name;
		this.userMessage = userMessage || message;
		this.originalError = originalError;
	}
}

export class ValidationError extends CliError {
	code = "VALIDATION_ERROR";
}

export class NetworkError extends CliError {
	code = "NETWORK_ERROR";
	userMessage: string;

	constructor(message: string, detail?: unknown) {
		let detailSuffix = "";
		const detailMessage =
			detail instanceof Error
				? detail.message
				: typeof detail === "string"
					? detail
					: undefined;
		if (
			detailMessage &&
			detailMessage !== message &&
			!message.includes(detailMessage)
		) {
			detailSuffix = `: ${detailMessage}`;
		}
		super(message, `Network error: ${message}${detailSuffix}`, detail);
		this.userMessage = `Network error: ${message}${detailSuffix}`;
	}
}

export class AuthenticationError extends CliError {
	code = "AUTH_ERROR";

	constructor(
		message: string,
		userMessage = "Authentication failed",
		originalError?: unknown,
	) {
		super(message, userMessage, originalError);
	}
}

export class ConfigurationError extends CliError {
	code = "CONFIG_ERROR";

	constructor(
		message: string,
		userMessage = "Configuration error",
		originalError?: unknown,
	) {
		super(message, userMessage, originalError);
	}
}
