import pino from "pino";
import pinoPretty from "pino-pretty";

// Global verbosity level: 0 = none, 1 = basic, 2 = full
let verbosityLevel = 0;
const SENSITIVE_LOG_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PARTS = [
	"token",
	"secret",
	"password",
	"authorization",
	"api_key",
	"apikey",
	"code_verifier",
] as const;

interface LoggedFetchOptions {
	includeRequestBody?: boolean;
	includeResponseBody?: boolean;
}

// Configure logger based on environment and verbosity level
const createLogger = () => {
	const isDev = process.env.NODE_ENV === "development";
	const level = verbosityLevel > 0 ? "debug" : "info";

	const redact = {
		paths: [
			"headers.Authorization",
			"headers.authorization",
			"body.headers.Authorization",
			"body.headers.authorization",
		],
		censor: "[REDACTED]",
	};

	if (isDev || verbosityLevel > 0) {
		const prettyStream = pinoPretty({
			colorize: true,
			translateTime: "HH:MM:ss",
			ignore: "pid,hostname",
			destination: 2,
		});
		return pino(
			{
				level,
				redact,
			},
			prettyStream,
		);
	}

	// Always log to stderr to keep stdout reserved for JSON command envelopes.
	return pino(
		{
			level,
			redact,
		},
		pino.destination(2),
	);
};

let logger = createLogger();

export const setVerbosityLevel = (level: number) => {
	verbosityLevel = level;
	logger = createLogger();
};

export const getVerbosityLevel = (): number => verbosityLevel;

export const getLogger = () => logger;

// HTTP request logging utilities
export const logHttpRequest = (options: {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: unknown;
}) => {
	if (verbosityLevel >= 2) {
		logger.debug(
			{
				type: "http_request",
				method: options.method,
				url: options.url,
				headers: options.headers,
				body: options.body,
			},
			`→ ${options.method} ${options.url}`,
		);
	} else if (verbosityLevel === 1) {
		logger.debug(`→ ${options.method} ${options.url}`);
	}
};

export const logHttpResponse = (options: {
	method: string;
	url: string;
	status: number;
	statusText?: string;
	headers?: Record<string, string>;
	body?: unknown;
	duration?: number;
}) => {
	if (verbosityLevel >= 2) {
		logger.debug(
			{
				type: "http_response",
				method: options.method,
				url: options.url,
				status: options.status,
				statusText: options.statusText,
				headers: options.headers,
				body: options.body,
				duration: options.duration,
			},
			`← ${options.status} ${options.method} ${options.url} ${
				options.duration ? `(${options.duration}ms)` : ""
			}`,
		);
	} else if (verbosityLevel === 1) {
		logger.debug(
			`← ${options.status} ${options.method} ${options.url} ${
				options.duration ? `(${options.duration}ms)` : ""
			}`,
		);
	}
};

const redactSensitiveFields = (obj: unknown): unknown => {
	if (typeof obj !== "object" || obj === null) {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map(redactSensitiveFields);
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		const lowerKey = key.toLowerCase();
		if (
			SENSITIVE_KEY_PARTS.some((part) => lowerKey.includes(part.toLowerCase()))
		) {
			result[key] = SENSITIVE_LOG_VALUE;
		} else if (typeof value === "object" && value !== null) {
			result[key] = redactSensitiveFields(value);
		} else {
			result[key] = value;
		}
	}
	return result;
};

function isSensitiveEndpoint(url: string): boolean {
	try {
		const path = new URL(url).pathname.toLowerCase();
		return path.includes("/oauth/token") || path.includes("/oauth2/token");
	} catch {
		const normalized = url.toLowerCase();
		return (
			normalized.includes("/oauth/token") ||
			normalized.includes("/oauth2/token")
		);
	}
}

function normalizeRequestBodyForLogs(body: RequestInit["body"]): unknown {
	if (body instanceof URLSearchParams) {
		return Object.fromEntries(body.entries());
	}
	return body;
}

export const loggedFetch = async (
	url: string,
	init?: RequestInit,
	options?: LoggedFetchOptions,
): Promise<Response> => {
	const method = init?.method ?? "(unknown)";
	const headers = init?.headers;
	const body = init?.body;
	const endpointSensitive = isSensitiveEndpoint(url);
	const includeRequestBody =
		(options?.includeRequestBody ?? true) && !endpointSensitive;
	const includeResponseBody =
		(options?.includeResponseBody ?? true) && !endpointSensitive;

	logHttpRequest({
		method,
		url,
		headers: headers as Record<string, string>,
		body: includeRequestBody
			? redactSensitiveFields(normalizeRequestBodyForLogs(body))
			: SENSITIVE_LOG_VALUE,
	});

	const startTime = Date.now();
	const response = await fetch(url, init);
	const duration = Date.now() - startTime;

	let responseBody: unknown;
	if (verbosityLevel >= 2 && response.ok && includeResponseBody) {
		const contentType = response.headers.get("content-type");
		if (contentType?.includes("application/json")) {
			const clonedResponse = response.clone();
			try {
				const jsonBody = await clonedResponse.json();
				responseBody = redactSensitiveFields(jsonBody);
			} catch {
				responseBody = undefined;
			}
		}
	} else if (!includeResponseBody) {
		responseBody = SENSITIVE_LOG_VALUE;
	}

	logHttpResponse({
		method,
		url,
		status: response.status,
		statusText: response.statusText,
		body: responseBody,
		duration,
	});

	return response;
};
