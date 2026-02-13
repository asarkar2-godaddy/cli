import crypto from "node:crypto";
import keytar from "keytar";
import {
	type Environment,
	envGet,
	getApiUrl,
	getClientId,
} from "./environment";

const KEYCHAIN_SERVICE = "godaddy-cli";
const LEGACY_TOKEN_KEY = "token";
const TOKEN_KEY_VERSION = "v2";

interface StoredTokenPayload {
	accessToken: string;
	expiresAt: string;
}

export interface StoredToken {
	accessToken: string;
	expiresAt: Date;
}

function getEnvironmentTokenKey(environment: Environment): string {
	return `token:${environment}`;
}

function getScopedTokenKey(
	environment: Environment,
	tokenEndpoint: string,
	clientId: string,
): string {
	const scopeMaterial = `${environment}|${tokenEndpoint}|${clientId}`;
	const scopeHash = crypto
		.createHash("sha256")
		.update(scopeMaterial)
		.digest("hex")
		.slice(0, 16);
	return `token:${TOKEN_KEY_VERSION}:${environment}:${scopeHash}`;
}

async function getCurrentEnvironment(): Promise<Environment> {
	const result = await envGet();
	if (result.success && result.data) {
		return result.data as Environment;
	}
	return "ote";
}

function getTokenEndpoint(environment: Environment): string {
	if (process.env.OAUTH_TOKEN_URL) {
		return process.env.OAUTH_TOKEN_URL;
	}

	return `${getApiUrl(environment)}/v2/oauth2/token`;
}

function getOauthClientId(environment: Environment): string {
	return getClientId(environment);
}

function getKeyContext(environment: Environment): {
	scopedTokenKey: string;
	legacyEnvironmentTokenKey: string;
} {
	const tokenEndpoint = getTokenEndpoint(environment);
	const clientId = getOauthClientId(environment);
	return {
		scopedTokenKey: getScopedTokenKey(environment, tokenEndpoint, clientId),
		legacyEnvironmentTokenKey: getEnvironmentTokenKey(environment),
	};
}

function serializeToken(token: StoredToken): string {
	return JSON.stringify({
		accessToken: token.accessToken,
		expiresAt: token.expiresAt.toISOString(),
	} satisfies StoredTokenPayload);
}

async function parseTokenValue(
	value: string,
	tokenKey: string,
): Promise<StoredToken | null> {
	try {
		const parsed = JSON.parse(value) as Partial<StoredTokenPayload>;
		const accessToken = parsed.accessToken;
		const expiresAtValue = parsed.expiresAt;

		if (typeof accessToken !== "string" || typeof expiresAtValue !== "string") {
			await keytar.deletePassword(KEYCHAIN_SERVICE, tokenKey);
			return null;
		}

		const expiresAt = new Date(expiresAtValue);
		if (Number.isNaN(expiresAt.getTime())) {
			await keytar.deletePassword(KEYCHAIN_SERVICE, tokenKey);
			return null;
		}

		if (expiresAt.getTime() <= Date.now()) {
			await keytar.deletePassword(KEYCHAIN_SERVICE, tokenKey);
			return null;
		}

		return { accessToken, expiresAt };
	} catch {
		await keytar.deletePassword(KEYCHAIN_SERVICE, tokenKey);
		return null;
	}
}

export async function saveToken(
	accessToken: string,
	expiresAt: Date,
	environment?: Environment,
): Promise<void> {
	const env = environment ?? (await getCurrentEnvironment());
	const { scopedTokenKey } = getKeyContext(env);
	const token = serializeToken({ accessToken, expiresAt });
	await keytar.setPassword(KEYCHAIN_SERVICE, scopedTokenKey, token);
}

export async function getStoredToken(
	environment?: Environment,
): Promise<StoredToken | null> {
	const env = environment ?? (await getCurrentEnvironment());
	const { scopedTokenKey, legacyEnvironmentTokenKey } = getKeyContext(env);

	const scopedValue = await keytar.getPassword(KEYCHAIN_SERVICE, scopedTokenKey);
	if (scopedValue) {
		return parseTokenValue(scopedValue, scopedTokenKey);
	}

	// Backward compatibility: migrate from previous environment-scoped key.
	const legacyEnvironmentValue = await keytar.getPassword(
		KEYCHAIN_SERVICE,
		legacyEnvironmentTokenKey,
	);
	if (legacyEnvironmentValue) {
		const legacyEnvironmentToken = await parseTokenValue(
			legacyEnvironmentValue,
			legacyEnvironmentTokenKey,
		);
		if (legacyEnvironmentToken) {
			try {
				await keytar.setPassword(
					KEYCHAIN_SERVICE,
					scopedTokenKey,
					serializeToken(legacyEnvironmentToken),
				);
				await keytar.deletePassword(KEYCHAIN_SERVICE, legacyEnvironmentTokenKey);
			} catch {
				// Non-fatal: return token even if migration write fails.
			}
			return legacyEnvironmentToken;
		}
	}

	// Backward compatibility: migrate from legacy token key if present.
	const legacyValue = await keytar.getPassword(
		KEYCHAIN_SERVICE,
		LEGACY_TOKEN_KEY,
	);
	if (!legacyValue) {
		return null;
	}

	const legacyToken = await parseTokenValue(legacyValue, LEGACY_TOKEN_KEY);
	if (!legacyToken) {
		return null;
	}

	try {
		await keytar.setPassword(
			KEYCHAIN_SERVICE,
			scopedTokenKey,
			serializeToken(legacyToken),
		);
		await keytar.deletePassword(KEYCHAIN_SERVICE, legacyEnvironmentTokenKey);
		await keytar.deletePassword(KEYCHAIN_SERVICE, LEGACY_TOKEN_KEY);
	} catch {
		// Non-fatal: return token even if migration write fails.
	}

	return legacyToken;
}

export async function deleteStoredToken(
	environment?: Environment,
): Promise<void> {
	const env = environment ?? (await getCurrentEnvironment());
	const { scopedTokenKey, legacyEnvironmentTokenKey } = getKeyContext(env);
	await keytar.deletePassword(KEYCHAIN_SERVICE, scopedTokenKey);
	await keytar.deletePassword(KEYCHAIN_SERVICE, legacyEnvironmentTokenKey);
	await keytar.deletePassword(KEYCHAIN_SERVICE, LEGACY_TOKEN_KEY);
}
