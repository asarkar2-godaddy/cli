import { Fetch } from "@effect/platform/FetchHttpClient";
import * as Layer from "effect/Layer";
import { Browser } from "../services/browser";
import { Keychain, type KeychainService } from "../services/keychain";

/**
 * Provide globalThis.fetch via the platform Fetch tag.
 * Layer.sync defers resolution so test mocks applied after module load take effect.
 */
export const FetchLive = Layer.sync(Fetch, () => globalThis.fetch);

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

/**
 * NodeLiveLayer — custom services only.
 * Platform services (FileSystem, Path, Terminal) come from NodeContext.layer.
 * The Fetch tag provides globalThis.fetch for HTTP calls.
 */
export const NodeLiveLayer = Layer.mergeAll(
	FetchLive,
	KeychainLive,
	BrowserLive,
);

export type CliServices = Fetch | Keychain | Browser;
