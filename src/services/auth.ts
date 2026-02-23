import {
	authenticate as coreAuthenticate,
	getAccessToken as coreGetAccessToken,
	getFromKeychain as coreGetFromKeychain,
	logout as coreLogout,
	stopAuthServer as coreStopAuthServer,
} from "../core/auth";

// Legacy compatibility wrappers.
export async function getFromKeychain(key: string): Promise<string | null> {
	return coreGetFromKeychain(key);
}

export async function authenticate(): Promise<{ success: boolean }> {
	return coreAuthenticate();
}

export function stopAuthServer(): void {
	coreStopAuthServer();
}

export async function logout(): Promise<void> {
	await coreLogout();
}

export async function getAccessToken(): Promise<string | null> {
	return coreGetAccessToken();
}
