/**
 * Stream event types for NDJSON streaming output.
 *
 * Emitted through the EnvelopeWriter service.
 */
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
    details?: Record<string, unknown>;
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
