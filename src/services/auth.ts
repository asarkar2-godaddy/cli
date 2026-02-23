import * as Effect from "effect/Effect";
import {
	authenticate as coreAuthenticate,
	getAccessToken as coreGetAccessToken,
	getFromKeychain as coreGetFromKeychain,
	logout as coreLogout,
	stopAuthServer as coreStopAuthServer,
} from "../core/auth";

// Legacy compatibility wrappers.
async function getFromKeychainPromise(key: string): Promise<string | null> {
	return coreGetFromKeychain(key);
}

async function authenticatePromise(): Promise<{ success: boolean }> {
	return coreAuthenticate();
}

export function stopAuthServer(): void {
	coreStopAuthServer();
}

async function logoutPromise(): Promise<void> {
	await coreLogout();
}

async function getAccessTokenPromise(): Promise<string | null> {
	return coreGetAccessToken();
}

export function getFromKeychainEffect(...args: Parameters<typeof getFromKeychainPromise>): Effect.Effect<Awaited<ReturnType<typeof getFromKeychainPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => getFromKeychainPromise(...args),
		catch: (error) => error,
	});
}

export function authenticateEffect(...args: Parameters<typeof authenticatePromise>): Effect.Effect<Awaited<ReturnType<typeof authenticatePromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => authenticatePromise(...args),
		catch: (error) => error,
	});
}

export function logoutEffect(...args: Parameters<typeof logoutPromise>): Effect.Effect<Awaited<ReturnType<typeof logoutPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => logoutPromise(...args),
		catch: (error) => error,
	});
}

export function getAccessTokenEffect(...args: Parameters<typeof getAccessTokenPromise>): Effect.Effect<Awaited<ReturnType<typeof getAccessTokenPromise>>, unknown, never> {
	return Effect.tryPromise({
		try: () => getAccessTokenPromise(...args),
		catch: (error) => error,
	});
}

export function getFromKeychain(
	...args: Parameters<typeof getFromKeychainPromise>
): Promise<Awaited<ReturnType<typeof getFromKeychainPromise>>> {
	return Effect.runPromise(getFromKeychainEffect(...args));
}

export function authenticate(
	...args: Parameters<typeof authenticatePromise>
): Promise<Awaited<ReturnType<typeof authenticatePromise>>> {
	return Effect.runPromise(authenticateEffect(...args));
}

export function logout(
	...args: Parameters<typeof logoutPromise>
): Promise<Awaited<ReturnType<typeof logoutPromise>>> {
	return Effect.runPromise(logoutEffect(...args));
}

export function getAccessToken(
	...args: Parameters<typeof getAccessTokenPromise>
): Promise<Awaited<ReturnType<typeof getAccessTokenPromise>>> {
	return Effect.runPromise(getAccessTokenEffect(...args));
}
