import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const CLI_PATH = join(process.cwd(), "dist", "cli.js");

function runCli(args: string[]) {
	const result = spawnSync("node", [CLI_PATH, ...args], {
		encoding: "utf-8",
	});
	return {
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
		status: result.status ?? 0,
	};
}

describe("CLI Smoke Tests", () => {
	beforeAll(() => {
		if (!existsSync(CLI_PATH)) {
			execSync("pnpm run build", { stdio: "inherit" });
		}
	});

	it("root command returns JSON discovery envelope", () => {
		const result = runCli([]);
		expect(result.status).toBe(0);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("godaddy");
		expect(payload.result.command_tree.command).toBe("godaddy");
		expect(Array.isArray(payload.next_actions)).toBe(true);
	});

	it("--pretty formats success envelopes with indentation", () => {
		const result = runCli(["--pretty"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('\n  "ok": true');
		expect(result.stdout).toContain('\n  "result": {');

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(true);
	});

	it("application parent command returns subtree discovery envelope", () => {
		const result = runCli(["application"]);
		expect(result.status).toBe(0);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(true);
		expect(payload.result.command).toBe("godaddy application");
		expect(Array.isArray(payload.result.commands)).toBe(true);
	});

	it("unknown command returns structured error envelope", () => {
		const result = runCli(["nonexistent-command"]);
		expect(result.status).toBe(1);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(false);
		expect(payload.error.code).toBe("COMMAND_NOT_FOUND");
		expect(payload.fix).toContain("godaddy");
	});

	it("--pretty formats structured error envelopes with indentation", () => {
		const result = runCli(["--pretty", "nonexistent-command"]);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('\n  "ok": false');
		expect(result.stdout).toContain('\n  "error": {');

		const payload = JSON.parse(result.stdout);
		expect(payload.error.code).toBe("COMMAND_NOT_FOUND");
	});

	it("unsupported --output option returns structured error envelope", () => {
		const result = runCli(["env", "get", "--output", "json"]);
		expect(result.status).toBe(1);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(false);
		expect(payload.error.code).toBe("UNSUPPORTED_OPTION");
	});

	it("application info requires <name> at parse-time", () => {
		const result = runCli(["application", "info"]);
		expect(result.status).toBe(1);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(false);
		expect(payload.error.code).toBe("VALIDATION_ERROR");
		expect(payload.error.message).toContain("Missing argument <name>");
	});

	it("application validate requires <name> at parse-time", () => {
		const result = runCli(["application", "validate"]);
		expect(result.status).toBe(1);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(false);
		expect(payload.error.code).toBe("VALIDATION_ERROR");
		expect(payload.error.message).toContain("Missing argument <name>");
	});

	it("--help still prints framework help text", () => {
		const result = runCli(["--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("COMMANDS");
		expect(result.stdout).toContain("application");
	});

	it("-v enables basic verbose mode", () => {
		const result = runCli(["-v"]);
		expect(result.status).toBe(0);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("godaddy -v");
		expect(result.stderr).toContain("(verbose output enabled)");
		expect(result.stderr).not.toContain("full details");
	});

	it("-vv enables full verbose mode", () => {
		const result = runCli(["-vv"]);
		expect(result.status).toBe(0);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("godaddy -vv");
		expect(result.stderr).toContain("(verbose output enabled: full details)");
	});

	it("repeated -v flags enable full verbose mode", () => {
		const result = runCli(["-v", "-v"]);
		expect(result.status).toBe(0);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("godaddy -v -v");
		expect(result.stderr).toContain("(verbose output enabled: full details)");
	});

	it("--info aliases to basic verbose mode", () => {
		const result = runCli(["--info"]);
		expect(result.status).toBe(0);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("godaddy --info");
		expect(result.stderr).toContain("(verbose output enabled)");
		expect(result.stderr).not.toContain("full details");
	});

	it("--debug aliases to full verbose mode", () => {
		const result = runCli(["--debug"]);
		expect(result.status).toBe(0);

		const payload = JSON.parse(result.stdout);
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("godaddy --debug");
		expect(result.stderr).toContain("(verbose output enabled: full details)");
	});
});
