import { Fetch } from "@effect/platform/FetchHttpClient";
import * as Layer from "effect/Layer";
import { Browser } from "../services/browser";
import { Keychain } from "../services/keychain";
import { createNativeKeychain } from "./keychain-native";

/**
 * Provide globalThis.fetch via the platform Fetch tag.
 * Layer.sync defers resolution so test mocks applied after module load take effect.
 */
export const FetchLive = Layer.sync(Fetch, () => globalThis.fetch);

/**
 * Keychain backed by OS credential stores (no native addons).
 * macOS: Keychain via `security` CLI
 * Linux: GNOME Keyring / KDE Wallet via `secret-tool` CLI
 * Windows: PasswordVault via PowerShell
 */
export const KeychainLive = Layer.sync(Keychain, () => createNativeKeychain());

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
