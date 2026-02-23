import * as Context from "effect/Context";

export interface KeychainCredential {
	readonly account: string;
	readonly password: string;
}

export interface KeychainService {
	readonly setPassword: (
		service: string,
		account: string,
		password: string,
	) => Promise<void>;
	readonly getPassword: (
		service: string,
		account: string,
	) => Promise<string | null>;
	readonly deletePassword: (
		service: string,
		account: string,
	) => Promise<boolean>;
	readonly findCredentials: (service: string) => Promise<KeychainCredential[]>;
}

export class Keychain extends Context.Tag("Keychain")<
	Keychain,
	KeychainService
>() {}
