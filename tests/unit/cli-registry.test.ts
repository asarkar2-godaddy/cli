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

describe("CLI command tree coverage", () => {
  beforeAll(() => {
    if (!existsSync(CLI_PATH)) {
      execSync("pnpm run build", { stdio: "inherit" });
    }
  });

  it("root command tree includes all top-level groups with ids", () => {
    const result = runCli([]);
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout);
    const children = payload.result.command_tree.children;

    const ids = children.map((c: { id: string }) => c.id);
    expect(ids).toContain("auth.group");
    expect(ids).toContain("env.group");
    expect(ids).toContain("api.group");
    expect(ids).toContain("actions.group");
    expect(ids).toContain("webhook.group");
    expect(ids).toContain("application.group");
  });

  it("every command tree node has command and description", () => {
    const result = runCli([]);
    const payload = JSON.parse(result.stdout);
    const children = payload.result.command_tree.children;

    for (const node of children) {
      expect(node.command.length).toBeGreaterThan(0);
      expect(node.description.length).toBeGreaterThan(0);

      if (node.children) {
        for (const child of node.children) {
          expect(child.command.length).toBeGreaterThan(0);
          expect(child.description.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("all root-level envelopes include next_actions", () => {
    const result = runCli([]);
    const payload = JSON.parse(result.stdout);
    expect(Array.isArray(payload.next_actions)).toBe(true);
    expect(payload.next_actions.length).toBeGreaterThan(0);
  });

  it("sub-group envelopes include next_actions", () => {
    const groupCommands = [
      "application",
      "auth",
      "env",
      "actions",
      "webhook",
      "api",
    ];
    for (const group of groupCommands) {
      const result = runCli([group]);
      if (result.status === 0) {
        const payload = JSON.parse(result.stdout);
        expect(Array.isArray(payload.next_actions)).toBe(true);
        expect(payload.next_actions.length).toBeGreaterThan(0);
      }
    }
  });
});
