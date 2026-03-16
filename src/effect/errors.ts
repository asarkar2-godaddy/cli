import * as Data from "effect/Data";

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly userMessage: string;
}> {}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly userMessage: string;
}> {}

export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError",
)<{
  readonly message: string;
  readonly userMessage: string;
}> {}

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly message: string;
  readonly userMessage: string;
}> {}

export class SecurityError extends Data.TaggedError("SecurityError")<{
  readonly message: string;
  readonly userMessage: string;
}> {}

export type CliError =
  | ValidationError
  | NetworkError
  | AuthenticationError
  | ConfigurationError
  | SecurityError;

export function errorCode(error: CliError): string {
  switch (error._tag) {
    case "ValidationError":
      return "VALIDATION_ERROR";
    case "NetworkError":
      return "NETWORK_ERROR";
    case "AuthenticationError":
      return "AUTH_ERROR";
    case "ConfigurationError":
      return "CONFIG_ERROR";
    case "SecurityError":
      return "SECURITY_BLOCKED";
  }
}
