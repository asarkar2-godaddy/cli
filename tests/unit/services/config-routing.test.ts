import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	createConfigFile,
	createEnvFile,
	getConfigFilePath,
	type Config,
} from "../../../src/services/config";

const TEST_CONFIG: Config = {
	name: "test-app",
	client_id: "a502484b-d7b1-4509-aa88-08b391a54c28",
	description: "Test app",
	version: "1.0.0",
	url: "https://example.com",
	proxy_url: "https://example.com/api",
	authorization_scopes: ["shopper.readonly"],
};

describe("Config Environment Routing", () => {
	const originalCwd = process.cwd();
	let tempDir = "";

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "godaddy-config-routing-"));
		process.chdir(tempDir);
	});

	afterEach(() => {
		delete process.env.GODADDY_API_BASE_URL;
		delete process.env.APPLICATIONS_GRAPHQL_URL;

		process.chdir(originalCwd);
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("routes ote config path to dev when base url contains dev-godaddy", () => {
		process.env.GODADDY_API_BASE_URL = "https://api.dev-godaddy.com";

		expect(path.basename(getConfigFilePath("ote"))).toBe("godaddy.dev.toml");
	});

	test("routes ote config path to test when graphql url contains test-godaddy", () => {
		process.env.APPLICATIONS_GRAPHQL_URL =
			"https://api.test-godaddy.com/v1/apps/app-registry-subgraph";

		expect(path.basename(getConfigFilePath("ote"))).toBe("godaddy.test.toml");
	});

	test("keeps requested environment when no dev/test override is present", () => {
		process.env.GODADDY_API_BASE_URL = "https://api.ote-godaddy.com";

		expect(path.basename(getConfigFilePath("ote"))).toBe("godaddy.ote.toml");
	});

	test("writes config to mapped environment file", async () => {
		process.env.GODADDY_API_BASE_URL = "https://api.dev-godaddy.com";

		await createConfigFile(TEST_CONFIG, "ote");

		expect(fs.existsSync(path.join(tempDir, "godaddy.dev.toml"))).toBe(true);
		expect(fs.existsSync(path.join(tempDir, "godaddy.ote.toml"))).toBe(false);
	});

	test("writes env file to mapped environment file", async () => {
		process.env.GODADDY_API_BASE_URL = "https://api.test-godaddy.com";

		await createEnvFile(
			{
				secret: "webhook-secret",
				publicKey: "public-key",
				clientId: "client-id",
				clientSecret: "client-secret",
			},
			"ote",
		);

		expect(fs.existsSync(path.join(tempDir, ".env.test"))).toBe(true);
		expect(fs.existsSync(path.join(tempDir, ".env.ote"))).toBe(false);
	});
});
