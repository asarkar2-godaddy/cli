import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  getSourceType,
  resolveEntryPoint,
  tryResolvePath,
} from "../../../src/core/extension/entry";
import { nodeFs } from "../../helpers/node-fs";

describe("Extension Entry Point Resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "godaddy-cli-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("getSourceType", () => {
    test('returns "module" when type is "module"', () => {
      const result = getSourceType({ type: "module" });
      expect(result).toBe("module");
    });

    test('returns "commonjs" when type is "commonjs"', () => {
      const result = getSourceType({ type: "commonjs" });
      expect(result).toBe("commonjs");
    });

    test('returns "commonjs" when type is undefined', () => {
      const result = getSourceType({});
      expect(result).toBe("commonjs");
    });

    test('returns "commonjs" when type is not a string', () => {
      const result = getSourceType({ type: 123 });
      expect(result).toBe("commonjs");
    });
  });

  describe("tryResolvePath", () => {
    test("returns absolute path when file exists", () => {
      const filePath = path.join(tempDir, "index.ts");
      fs.writeFileSync(filePath, "export {}");

      const result = tryResolvePath(tempDir, "index.ts", nodeFs);

      expect(result).toBe(filePath);
    });

    test("handles leading ./ in relative path", () => {
      const filePath = path.join(tempDir, "index.ts");
      fs.writeFileSync(filePath, "export {}");

      const result = tryResolvePath(tempDir, "./index.ts", nodeFs);

      expect(result).toBe(filePath);
    });

    test("returns null when file does not exist", () => {
      const result = tryResolvePath(tempDir, "nonexistent.ts", nodeFs);

      expect(result).toBeNull();
    });

    test("resolves nested paths", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const filePath = path.join(srcDir, "index.ts");
      fs.writeFileSync(filePath, "export {}");

      const result = tryResolvePath(tempDir, "src/index.ts", nodeFs);

      expect(result).toBe(filePath);
    });
  });

  describe("resolveEntryPoint", () => {
    test('resolves from exports["."].import', () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const entryPath = path.join(srcDir, "index.ts");
      fs.writeFileSync(entryPath, "export {}");

      const packageJson = {
        exports: {
          ".": {
            import: "./src/index.ts",
          },
        },
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.entryPath).toBe(entryPath);
      expect(result.sourceType).toBe("module");
      expect(result.resolvedFrom).toBe("exports.import");
    });

    test("resolves from module field", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const entryPath = path.join(srcDir, "index.ts");
      fs.writeFileSync(entryPath, "export {}");

      const packageJson = {
        module: "./src/index.ts",
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.entryPath).toBe(entryPath);
      expect(result.sourceType).toBe("module");
      expect(result.resolvedFrom).toBe("module");
    });

    test("resolves from main field", () => {
      const entryPath = path.join(tempDir, "index.js");
      fs.writeFileSync(entryPath, "module.exports = {}");

      const packageJson = {
        main: "./index.js",
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.entryPath).toBe(entryPath);
      expect(result.sourceType).toBe("commonjs");
      expect(result.resolvedFrom).toBe("main");
    });

    test("resolves from exports string field", () => {
      const entryPath = path.join(tempDir, "index.ts");
      fs.writeFileSync(entryPath, "export {}");

      const packageJson = {
        exports: "./index.ts",
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("exports");
    });

    test("falls back to src/index.ts", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const entryPath = path.join(srcDir, "index.ts");
      fs.writeFileSync(entryPath, "export {}");

      const result = resolveEntryPoint(
        {
          packageDir: tempDir,
          packageJson: {},
        },
        nodeFs,
      );

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("fallback");
    });

    test("falls back to src/index.tsx", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const entryPath = path.join(srcDir, "index.tsx");
      fs.writeFileSync(entryPath, "export {}");

      const result = resolveEntryPoint(
        {
          packageDir: tempDir,
          packageJson: {},
        },
        nodeFs,
      );

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("fallback");
    });

    test("falls back to src/index.mts", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const entryPath = path.join(srcDir, "index.mts");
      fs.writeFileSync(entryPath, "export {}");

      const result = resolveEntryPoint(
        {
          packageDir: tempDir,
          packageJson: {},
        },
        nodeFs,
      );

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("fallback");
    });

    test("falls back to index.ts", () => {
      const entryPath = path.join(tempDir, "index.ts");
      fs.writeFileSync(entryPath, "export {}");

      const result = resolveEntryPoint(
        {
          packageDir: tempDir,
          packageJson: {},
        },
        nodeFs,
      );

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("fallback");
    });

    test("falls back to index.mts", () => {
      const entryPath = path.join(tempDir, "index.mts");
      fs.writeFileSync(entryPath, "export {}");

      const result = resolveEntryPoint(
        {
          packageDir: tempDir,
          packageJson: {},
        },
        nodeFs,
      );

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("fallback");
    });

    test("falls back to src/index.js", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const entryPath = path.join(srcDir, "index.js");
      fs.writeFileSync(entryPath, "module.exports = {}");

      const result = resolveEntryPoint(
        {
          packageDir: tempDir,
          packageJson: {},
        },
        nodeFs,
      );

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("fallback");
    });

    test("falls back to index.js", () => {
      const entryPath = path.join(tempDir, "index.js");
      fs.writeFileSync(entryPath, "module.exports = {}");

      const result = resolveEntryPoint(
        {
          packageDir: tempDir,
          packageJson: {},
        },
        nodeFs,
      );

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("fallback");
    });

    test("prioritizes exports.import over module", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const exportsPath = path.join(srcDir, "exports.ts");
      const modulePath = path.join(srcDir, "module.ts");
      fs.writeFileSync(exportsPath, "export {}");
      fs.writeFileSync(modulePath, "export {}");

      const packageJson = {
        exports: {
          ".": {
            import: "./src/exports.ts",
          },
        },
        module: "./src/module.ts",
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.entryPath).toBe(exportsPath);
      expect(result.resolvedFrom).toBe("exports.import");
    });

    test("prioritizes module over main", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const modulePath = path.join(srcDir, "module.ts");
      const mainPath = path.join(srcDir, "main.js");
      fs.writeFileSync(modulePath, "export {}");
      fs.writeFileSync(mainPath, "module.exports = {}");

      const packageJson = {
        module: "./src/module.ts",
        main: "./src/main.js",
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.entryPath).toBe(modulePath);
      expect(result.resolvedFrom).toBe("module");
    });

    test("prioritizes main over fallback", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const mainPath = path.join(tempDir, "main.js");
      const fallbackPath = path.join(srcDir, "index.ts");
      fs.writeFileSync(mainPath, "module.exports = {}");
      fs.writeFileSync(fallbackPath, "export {}");

      const packageJson = {
        main: "./main.js",
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.entryPath).toBe(mainPath);
      expect(result.resolvedFrom).toBe("main");
    });

    test("throws error when no entry point found", () => {
      expect(() =>
        resolveEntryPoint(
          {
            packageDir: tempDir,
            packageJson: {},
          },
          nodeFs,
        ),
      ).toThrow("No entry point found");
    });

    test("throws error when exports.import path does not exist", () => {
      const packageJson = {
        exports: {
          ".": {
            import: "./nonexistent.ts",
          },
        },
      };

      // Should continue to next priority, then throw because nothing found
      expect(() =>
        resolveEntryPoint({ packageDir: tempDir, packageJson }),
      ).toThrow("No entry point found");
    });

    test("respects package.json type field for sourceType", () => {
      const entryPath = path.join(tempDir, "index.js");
      fs.writeFileSync(entryPath, "export {}");

      const packageJson = {
        type: "module",
        main: "./index.js",
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.sourceType).toBe("module");
    });

    test("handles complex exports object structure", () => {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir);
      const entryPath = path.join(srcDir, "index.ts");
      fs.writeFileSync(entryPath, "export {}");

      const packageJson = {
        exports: {
          ".": {
            import: "./src/index.ts",
            require: "./dist/index.js",
          },
          "./utils": "./src/utils.ts",
        },
      };

      const result = resolveEntryPoint({ packageDir: tempDir, packageJson });

      expect(result.entryPath).toBe(entryPath);
      expect(result.resolvedFrom).toBe("exports.import");
    });
  });
});
