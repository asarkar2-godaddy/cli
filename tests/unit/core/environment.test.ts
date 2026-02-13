import { afterEach, describe, expect, test } from "vitest";
import {
	envGet,
	envInfo,
	envList,
	setRuntimeEnvironmentOverride,
} from "../../../src/core/environment";

afterEach(() => {
	setRuntimeEnvironmentOverride(null);
});

describe("Environment Runtime Override", () => {
	test("envGet returns runtime override when set", async () => {
		setRuntimeEnvironmentOverride("prod");

		const result = await envGet();

		expect(result.success).toBe(true);
		expect(result.data).toBe("prod");
	});

	test("envList places runtime override first", async () => {
		setRuntimeEnvironmentOverride("prod");

		const result = await envList();

		expect(result.success).toBe(true);
		expect(result.data?.[0]).toBe("prod");
	});

	test("envInfo uses runtime override when no explicit env is provided", async () => {
		setRuntimeEnvironmentOverride("prod");

		const result = await envInfo();

		expect(result.success).toBe(true);
		expect(result.data?.environment).toBe("prod");
	});
});
