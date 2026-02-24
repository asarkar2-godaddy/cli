import { afterEach, describe, expect, test } from "vitest";
import {
	envGetEffect,
	envInfoEffect,
	envListEffect,
	setRuntimeEnvironmentOverride,
} from "../../../src/core/environment";
import { runEffect } from "../../setup/effect-test-utils";

afterEach(() => {
	setRuntimeEnvironmentOverride(null);
});

describe("Environment Runtime Override", () => {
	test("envGet returns runtime override when set", async () => {
		setRuntimeEnvironmentOverride("prod");

		const result = await runEffect(envGetEffect());

		expect(result).toBe("prod");
	});

	test("envList places runtime override first", async () => {
		setRuntimeEnvironmentOverride("prod");

		const result = await runEffect(envListEffect());

		expect(result[0]).toBe("prod");
	});

	test("envInfo uses runtime override when no explicit env is provided", async () => {
		setRuntimeEnvironmentOverride("prod");

		const result = await runEffect(envInfoEffect());

		expect(result.environment).toBe("prod");
	});
});
