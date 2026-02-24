/**
 * Cross-platform keychain implementation using OS credential stores.
 *
 * - macOS:   `security` CLI (Keychain Services)
 * - Linux:   `secret-tool` CLI (libsecret / GNOME Keyring / KDE Wallet)
 * - Windows: PowerShell PasswordVault (UWP, Windows 10+)
 *
 * No native Node addons required.
 */

import { execFile } from "node:child_process";
import type {
	KeychainCredential,
	KeychainService,
} from "../services/keychain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ExecResult {
	stdout: string;
	stderr: string;
	code: number | null;
}

function exec(
	cmd: string,
	args: string[],
	options?: { input?: string },
): Promise<ExecResult> {
	return new Promise((resolve) => {
		const child = execFile(
			cmd,
			args,
			{ encoding: "utf-8", timeout: 10_000 },
			(error, stdout, stderr) => {
				resolve({
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					code: error ? (error as unknown as { status?: number }).status ?? 1 : 0,
				});
			},
		);
		if (options?.input && child.stdin) {
			child.stdin.write(options.input);
			child.stdin.end();
		}
	});
}

function powershell(script: string): Promise<ExecResult> {
	return exec("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		script,
	]);
}

// ---------------------------------------------------------------------------
// macOS — `security` CLI
// ---------------------------------------------------------------------------

function createMacOSKeychain(): KeychainService {
	return {
		async setPassword(service, account, password) {
			// -U updates an existing entry instead of failing with duplicate
			const result = await exec("security", [
				"add-generic-password",
				"-s",
				service,
				"-a",
				account,
				"-w",
				password,
				"-U",
			]);
			if (result.code !== 0) {
				throw new Error(
					`security add-generic-password failed (${result.code}): ${result.stderr}`,
				);
			}
		},

		async getPassword(service, account) {
			const result = await exec("security", [
				"find-generic-password",
				"-s",
				service,
				"-a",
				account,
				"-w",
			]);
			// Exit code 44 = item not found
			if (result.code !== 0) {
				return null;
			}
			return result.stdout.replace(/\n$/, "");
		},

		async deletePassword(service, account) {
			const result = await exec("security", [
				"delete-generic-password",
				"-s",
				service,
				"-a",
				account,
			]);
			return result.code === 0;
		},

		async findCredentials(service) {
			// Step 1: dump keychain to discover account names for this service
			const dump = await exec("security", ["dump-keychain"]);
			if (dump.code !== 0) {
				return [];
			}

			const accounts = parseDumpForService(dump.stdout, service);
			if (accounts.length === 0) {
				return [];
			}

			// Step 2: fetch each password individually
			const credentials: KeychainCredential[] = [];
			for (const account of accounts) {
				const result = await exec("security", [
					"find-generic-password",
					"-s",
					service,
					"-a",
					account,
					"-w",
				]);
				if (result.code === 0) {
					credentials.push({
						account,
						password: result.stdout.replace(/\n$/, ""),
					});
				}
			}
			return credentials;
		},
	};
}

/**
 * Parse `security dump-keychain` output for entries matching a service.
 * Returns the unique account names found.
 */
function parseDumpForService(output: string, service: string): string[] {
	const accounts: string[] = [];
	// Split into blocks separated by "keychain:" headers
	const blocks = output.split(/^keychain:/m);

	for (const block of blocks) {
		// Only look at generic password entries
		if (!block.includes('class: "genp"')) continue;

		let blockService: string | null = null;
		let blockAccount: string | null = null;

		for (const line of block.split("\n")) {
			const svcMatch = line.match(/"svce"<blob>="([^"]*)"/);
			if (svcMatch) blockService = svcMatch[1];

			const acctMatch = line.match(/"acct"<blob>="([^"]*)"/);
			if (acctMatch) blockAccount = acctMatch[1];
		}

		if (blockService === service && blockAccount) {
			accounts.push(blockAccount);
		}
	}

	return [...new Set(accounts)];
}

// ---------------------------------------------------------------------------
// Linux — `secret-tool` CLI (libsecret)
// ---------------------------------------------------------------------------

function createLinuxKeychain(): KeychainService {
	return {
		async setPassword(service, account, password) {
			const result = await exec(
				"secret-tool",
				[
					"store",
					"--label",
					`${service}/${account}`,
					"service",
					service,
					"account",
					account,
				],
				{ input: password },
			);
			if (result.code !== 0) {
				throw new Error(
					`secret-tool store failed (${result.code}): ${result.stderr}`,
				);
			}
		},

		async getPassword(service, account) {
			const result = await exec("secret-tool", [
				"lookup",
				"service",
				service,
				"account",
				account,
			]);
			if (result.code !== 0 || result.stdout.length === 0) {
				return null;
			}
			return result.stdout;
		},

		async deletePassword(service, account) {
			const result = await exec("secret-tool", [
				"clear",
				"service",
				service,
				"account",
				account,
			]);
			return result.code === 0;
		},

		async findCredentials(service) {
			const result = await exec("secret-tool", [
				"search",
				"--all",
				"service",
				service,
			]);
			if (result.code !== 0) {
				return [];
			}
			return parseSecretToolSearch(result.stdout);
		},
	};
}

/**
 * Parse `secret-tool search --all` output.
 *
 * Format:
 *   [/org/freedesktop/secrets/collection/login/1]
 *   label = ...
 *   secret = the-password
 *   ...
 *   attribute.account = the-account
 *   ...
 */
function parseSecretToolSearch(output: string): KeychainCredential[] {
	const credentials: KeychainCredential[] = [];
	// Split on entry headers
	const entries = output.split(/^\[/m).filter((s) => s.trim().length > 0);

	for (const entry of entries) {
		let account: string | null = null;
		let secret: string | null = null;

		for (const line of entry.split("\n")) {
			const accountMatch = line.match(/^attribute\.account\s*=\s*(.+)$/);
			if (accountMatch) account = accountMatch[1].trim();

			const secretMatch = line.match(/^secret\s*=\s*(.+)$/);
			if (secretMatch) secret = secretMatch[1].trim();
		}

		if (account && secret) {
			credentials.push({ account, password: secret });
		}
	}
	return credentials;
}

// ---------------------------------------------------------------------------
// Windows — PowerShell PasswordVault (UWP, Windows 10+)
// ---------------------------------------------------------------------------

function createWindowsKeychain(): KeychainService {
	const vaultInit = `[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]; $vault = New-Object Windows.Security.Credentials.PasswordVault`;

	return {
		async setPassword(service, account, password) {
			// Remove existing entry first (PasswordVault throws on duplicate)
			const removeScript = `
				${vaultInit}
				try {
					$old = $vault.Retrieve('${escapePS(service)}','${escapePS(account)}')
					$vault.Remove($old)
				} catch {}
				$cred = New-Object Windows.Security.Credentials.PasswordCredential('${escapePS(service)}','${escapePS(account)}','${escapePS(password)}')
				$vault.Add($cred)
			`;
			const result = await powershell(removeScript);
			if (result.code !== 0) {
				throw new Error(
					`PasswordVault.Add failed (${result.code}): ${result.stderr}`,
				);
			}
		},

		async getPassword(service, account) {
			const script = `
				${vaultInit}
				try {
					$cred = $vault.Retrieve('${escapePS(service)}','${escapePS(account)}')
					$cred.RetrievePassword()
					Write-Output $cred.Password
				} catch {
					exit 1
				}
			`;
			const result = await powershell(script);
			if (result.code !== 0 || result.stdout.trim().length === 0) {
				return null;
			}
			return result.stdout.trim();
		},

		async deletePassword(service, account) {
			const script = `
				${vaultInit}
				try {
					$cred = $vault.Retrieve('${escapePS(service)}','${escapePS(account)}')
					$vault.Remove($cred)
				} catch {
					exit 1
				}
			`;
			const result = await powershell(script);
			return result.code === 0;
		},

		async findCredentials(service) {
			const script = `
				${vaultInit}
				try {
					$creds = $vault.FindAllByResource('${escapePS(service)}')
					foreach ($c in $creds) {
						$c.RetrievePassword()
						Write-Output "$($c.UserName)|$($c.Password)"
					}
				} catch {
					# No credentials found — not an error
				}
			`;
			const result = await powershell(script);
			if (result.code !== 0 || result.stdout.trim().length === 0) {
				return [];
			}

			const credentials: KeychainCredential[] = [];
			for (const line of result.stdout.trim().split("\n")) {
				const separatorIndex = line.indexOf("|");
				if (separatorIndex === -1) continue;
				credentials.push({
					account: line.slice(0, separatorIndex),
					password: line.slice(separatorIndex + 1),
				});
			}
			return credentials;
		},
	};
}

/** Escape single quotes for PowerShell string literals. */
function escapePS(value: string): string {
	return value.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createNativeKeychain(): KeychainService {
	switch (process.platform) {
		case "darwin":
			return createMacOSKeychain();
		case "linux":
			return createLinuxKeychain();
		case "win32":
			return createWindowsKeychain();
		default:
			throw new Error(
				`Unsupported platform for credential storage: ${process.platform}`,
			);
	}
}
