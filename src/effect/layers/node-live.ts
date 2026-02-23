import * as fs from "node:fs";
import * as Layer from "effect/Layer";
import { Browser } from "../services/browser";
import { Clock } from "../services/clock";
import { FileSystem, type FileSystemService } from "../services/filesystem";
import { HttpClient } from "../services/http";
import { Keychain, type KeychainService } from "../services/keychain";

export const HttpClientLive = Layer.sync(HttpClient, () => ({
	fetch: (input: RequestInfo | URL, init?: RequestInit) =>
		globalThis.fetch(input, init),
}));

export const FileSystemLive = Layer.succeed(FileSystem, {
	readFileSync: (path: string, encoding: BufferEncoding) =>
		fs.readFileSync(path, encoding),
	writeFileSync: (path: string, data: string | NodeJS.ArrayBufferView) =>
		fs.writeFileSync(path, data),
	existsSync: (path: string) => fs.existsSync(path),
	mkdirSync: (path: string, options?: fs.MakeDirectoryOptions) =>
		fs.mkdirSync(path, options),
	mkdtempSync: (prefix: string) => fs.mkdtempSync(prefix),
	readdirSync: ((path: string, options?: unknown) =>
		options
			? fs.readdirSync(path, options as Parameters<typeof fs.readdirSync>[1])
			: fs.readdirSync(path)) as FileSystemService["readdirSync"],
	statSync: (path: string) => fs.statSync(path),
	rmSync: (path: string, options?: fs.RmOptions) => fs.rmSync(path, options),
});

export const KeychainLive = Layer.sync(Keychain, () => {
	let keytarPromise: Promise<KeychainService> | undefined;

	function getKeytar(): Promise<KeychainService> {
		if (!keytarPromise) {
			keytarPromise = import("keytar").then((module) => {
				const defaultExport = (module as { default?: unknown }).default;
				const api = defaultExport ?? module;
				const target = api as Record<string, unknown>;
				if (
					typeof target.setPassword !== "function" ||
					typeof target.getPassword !== "function" ||
					typeof target.deletePassword !== "function" ||
					typeof target.findCredentials !== "function"
				) {
					throw new Error("Keytar module does not expose the expected API");
				}
				return api as KeychainService;
			});
		}
		return keytarPromise;
	}

	return {
		setPassword: async (service, account, password) => {
			const kt = await getKeytar();
			return kt.setPassword(service, account, password);
		},
		getPassword: async (service, account) => {
			const kt = await getKeytar();
			return kt.getPassword(service, account);
		},
		deletePassword: async (service, account) => {
			const kt = await getKeytar();
			return kt.deletePassword(service, account);
		},
		findCredentials: async (service) => {
			const kt = await getKeytar();
			return kt.findCredentials(service);
		},
	};
});

export const BrowserLive = Layer.sync(Browser, () => ({
	open: async (url: string) => {
		const mod = await import("open");
		const openFn = (mod.default ?? mod) as (url: string) => Promise<unknown>;
		return openFn(url);
	},
}));

export const ClockLive = Layer.succeed(Clock, { now: () => Date.now() });

export const NodeLiveLayer = Layer.mergeAll(
	HttpClientLive,
	FileSystemLive,
	KeychainLive,
	BrowserLive,
	ClockLive,
);

export type CliServices = HttpClient | FileSystem | Keychain | Browser | Clock;
