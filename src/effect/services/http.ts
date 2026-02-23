import * as Context from "effect/Context";

export interface HttpClientService {
	readonly fetch: typeof globalThis.fetch;
}

export class HttpClient extends Context.Tag("HttpClient")<
	HttpClient,
	HttpClientService
>() {}
