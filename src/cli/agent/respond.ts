import type {
	AgentEnvelope,
	AgentErrorEnvelope,
	AgentSuccessEnvelope,
	NextAction,
} from "./types";

let envelopeWritten = false;
let prettyPrintEnabled = false;

function serializeEnvelope(envelope: AgentEnvelope): string {
	return prettyPrintEnabled
		? JSON.stringify(envelope, null, 2)
		: JSON.stringify(envelope);
}

function writeEnvelope(envelope: AgentEnvelope): void {
	if (envelopeWritten) {
		return;
	}

	process.stdout.write(`${serializeEnvelope(envelope)}\n`);
	markEnvelopeWritten();
}

export function resetEnvelopeWriter(): void {
	envelopeWritten = false;
	prettyPrintEnabled = false;
}

export function setEnvelopePrettyPrint(enabled: boolean): void {
	prettyPrintEnabled = enabled;
}

export function hasWrittenEnvelope(): boolean {
	return envelopeWritten;
}

export function markEnvelopeWritten(): void {
	envelopeWritten = true;
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
