import { describe, expect, it } from "vitest";
import { nextActionsFor } from "../../src/cli/agent/next-actions";
import {
	flattenRegistry,
	registryCoverage,
	type CommandId,
} from "../../src/cli/agent/registry";

describe("CLI registry coverage", () => {
	it("all registered commands have descriptions and next actions", () => {
		const nodes = flattenRegistry();

		for (const node of nodes) {
			expect(node.description.length).toBeGreaterThan(0);
			expect(node.usage.length).toBeGreaterThan(0);

			const actions = nextActionsFor(node.id as CommandId);
			expect(actions.length).toBeGreaterThan(0);
		}
	});

	it("coverage index includes each command id", () => {
		const nodes = flattenRegistry();
		for (const node of nodes) {
			expect(registryCoverage[node.id as CommandId]).toBe(true);
		}
	});
});
