import type { CmdResult } from "../../shared/types";
import type {
	AgentEnvelope,
	AgentErrorEnvelope,
	AgentSuccessEnvelope,
	NextAction,
} from "./types";

let envelopeWritten = false;

function writeEnvelope(envelope: AgentEnvelope): void {
	if (envelopeWritten) {
		return;
	}

	process.stdout.write(`${JSON.stringify(envelope)}\n`);
	envelopeWritten = true;
}

export function resetEnvelopeWriter(): void {
	envelopeWritten = false;
}

export function hasWrittenEnvelope(): boolean {
	return envelopeWritten;
}

export function currentCommandString(): string {
	const args = process.argv.slice(2);
	if (args.length === 0) {
		return "godaddy";
	}
	return `godaddy ${args.join(" ")}`;
}

export function emitSuccess<T>(
	command: string,
	result: T,
	nextActions: NextAction[],
): AgentSuccessEnvelope<T> {
	const envelope: AgentSuccessEnvelope<T> = {
		ok: true,
		command,
		result,
		next_actions: nextActions,
	};
	writeEnvelope(envelope);
	return envelope;
}

export function emitError(
	command: string,
	error: { message: string; code: string },
	fix: string,
	nextActions: NextAction[],
): AgentErrorEnvelope {
	const envelope: AgentErrorEnvelope = {
		ok: false,
		command,
		error,
		fix,
		next_actions: nextActions,
	};
	writeEnvelope(envelope);
	process.exitCode = 1;
	return envelope;
}

export function unwrapResult<T>(
	result: CmdResult<T>,
	fallbackMessage: string,
): T {
	if (!result.success) {
		throw result.error ?? new Error(fallbackMessage);
	}

	return result.data as T;
}
