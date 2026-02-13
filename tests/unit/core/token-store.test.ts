import { afterEach, describe, expect, test } from "vitest";
import { setRuntimeEnvironmentOverride } from "../../../src/core/environment";
import {
	deleteStoredToken,
	getStoredToken,
	saveToken,
} from "../../../src/core/token-store";
import { mockKeytar } from "../../setup/system-mocks";

afterEach(() => {
	setRuntimeEnvironmentOverride(null);
});

describe("Token Store", () => {
	test("saves token using active environment-scoped key", async () => {
		setRuntimeEnvironmentOverride("prod");
		const expiresAt = new Date(Date.now() + 60_000);

		await saveToken("test-token", expiresAt);

		expect(mockKeytar.setPassword).toHaveBeenCalledWith(
			"godaddy-cli",
			expect.stringMatching(/^token:v2:prod:/),
			expect.stringContaining('"accessToken":"test-token"'),
		);
	});

	test("reads token from environment-scoped key", async () => {
		mockKeytar.getPassword.mockResolvedValueOnce(
			JSON.stringify({
				accessToken: "env-token",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}),
		);

		const result = await getStoredToken("ote");

		expect(result?.accessToken).toBe("env-token");
		expect(mockKeytar.getPassword).toHaveBeenCalledWith(
			"godaddy-cli",
			expect.stringMatching(/^token:v2:ote:/),
		);
	});

	test("migrates previous environment key to scoped key", async () => {
		mockKeytar.getPassword.mockResolvedValueOnce(null).mockResolvedValueOnce(
			JSON.stringify({
				accessToken: "old-env-token",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}),
		);

		const result = await getStoredToken("prod");

		expect(result?.accessToken).toBe("old-env-token");
		expect(mockKeytar.setPassword).toHaveBeenCalledWith(
			"godaddy-cli",
			expect.stringMatching(/^token:v2:prod:/),
			expect.stringContaining('"accessToken":"old-env-token"'),
		);
		expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
			"godaddy-cli",
			"token:prod",
		);
	});

	test("migrates legacy token key to scoped key", async () => {
		mockKeytar.getPassword
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(
				JSON.stringify({
					accessToken: "legacy-token",
					expiresAt: new Date(Date.now() + 60_000).toISOString(),
				}),
			);

		const result = await getStoredToken("prod");

		expect(result?.accessToken).toBe("legacy-token");
		expect(mockKeytar.setPassword).toHaveBeenCalledWith(
			"godaddy-cli",
			expect.stringMatching(/^token:v2:prod:/),
			expect.stringContaining('"accessToken":"legacy-token"'),
		);
		expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
			"godaddy-cli",
			"token",
		);
	});

	test("deletes environment and legacy token keys during logout", async () => {
		await deleteStoredToken("prod");

		expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
			"godaddy-cli",
			expect.stringMatching(/^token:v2:prod:/),
		);
		expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
			"godaddy-cli",
			"token:prod",
		);
		expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
			"godaddy-cli",
			"token",
		);
	});
});
