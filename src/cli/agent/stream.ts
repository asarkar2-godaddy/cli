import { markEnvelopeWritten } from "./respond";
import type { NextAction } from "./types";

export interface StreamStartEvent {
	type: "start";
	command: string;
	ts: string;
}

export interface StreamStepEvent {
	type: "step";
	name: string;
	status: "started" | "completed" | "failed";
	message?: string;
	extension_name?: string;
	details?: Record<string, unknown>;
	ts: string;
}

export interface StreamProgressEvent {
	type: "progress";
	name: string;
	percent?: number;
	message?: string;
	details?: Record<string, unknown>;
	ts: string;
}

export interface StreamResultEvent<T = unknown> {
	type: "result";
	ok: true;
	command: string;
	result: T;
	next_actions: NextAction[];
}

export interface StreamErrorEvent {
	type: "error";
	ok: false;
	command: string;
	error: {
		message: string;
		code: string;
	};
	fix: string;
	next_actions: NextAction[];
}

export type StreamEvent<T = unknown> =
	| StreamStartEvent
	| StreamStepEvent
	| StreamProgressEvent
	| StreamResultEvent<T>
	| StreamErrorEvent;

function writeStreamEvent(event: StreamEvent): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

export function emitStreamEvent(event: StreamEvent): void {
	writeStreamEvent(event);
}

export function emitStreamStart(command: string): void {
	writeStreamEvent({
		type: "start",
		command,
		ts: new Date().toISOString(),
	});
}

export function emitStreamStep(event: {
	name: string;
	status: "started" | "completed" | "failed";
	message?: string;
	extensionName?: string;
	details?: Record<string, unknown>;
}): void {
	writeStreamEvent({
		type: "step",
		name: event.name,
		status: event.status,
		message: event.message,
		extension_name: event.extensionName,
		details: event.details,
		ts: new Date().toISOString(),
	});
}

export function emitStreamProgress(event: {
	name: string;
	percent?: number;
	message?: string;
	details?: Record<string, unknown>;
}): void {
	writeStreamEvent({
		type: "progress",
		name: event.name,
		percent: event.percent,
		message: event.message,
		details: event.details,
		ts: new Date().toISOString(),
	});
}

export function emitStreamResult<T>(
	command: string,
	result: T,
	nextActions: NextAction[],
): void {
	writeStreamEvent({
		type: "result",
		ok: true,
		command,
		result,
		next_actions: nextActions,
	});
	markEnvelopeWritten();
}

export function emitStreamError(
	command: string,
	error: { message: string; code: string },
	fix: string,
	nextActions: NextAction[],
): void {
	writeStreamEvent({
		type: "error",
		ok: false,
		command,
		error,
		fix,
		next_actions: nextActions,
	});
	process.exitCode = 1;
	markEnvelopeWritten();
}
