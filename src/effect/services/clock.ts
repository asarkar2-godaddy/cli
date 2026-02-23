import * as Context from "effect/Context";

export interface ClockService {
	readonly now: () => number;
}

export class Clock extends Context.Tag("Clock")<Clock, ClockService>() {}
