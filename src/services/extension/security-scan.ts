import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as ts from "typescript";
import { buildAliasMaps } from "../../core/security/alias-builder";
import { scanBundleContent } from "../../core/security/bundle-scanner";
import { getSecurityConfig } from "../../core/security/config";
import { scanFile } from "../../core/security/engine";
import { findFilesToScan } from "../../core/security/file-discovery";
import { BUNDLE_RULES } from "../../core/security/rules/bundle";
import { RULES } from "../../core/security/rules/index";
import { scanPackageScripts } from "../../core/security/scripts-scanner";
import type {
	Finding,
	ScanReport,
	ScanSummary,
} from "../../core/security/types";
import { SecurityError } from "../../effect/errors";
import type { FileSystem } from "../../effect/services/filesystem";

/**
 * Output format for scan results
 */
export type ScanOutputFormat = "text" | "json";

/**
 * Orchestrate complete security scan of an extension package.
 *
 * Performs the following steps:
 * 1. Get immutable strict security configuration
 * 2. Scan package.json scripts for suspicious patterns (SEC011)
 * 3. Discover all source files in package directory
 * 4. For each source file:
 *    - Read file content
 *    - Build alias maps for import/require tracking
 *    - Scan with all enabled security rules
 * 5. Aggregate findings and build comprehensive scan report
 * 6. Sort findings by file path, then line number
 *
 * @param packageDir - Absolute or relative path to extension package directory
 * @returns Effect containing ScanReport with all findings, block status, summary statistics
 */
export function scanExtensionEffect(
	packageDir: string,
): Effect.Effect<ScanReport, SecurityError, FileSystem> {
	return Effect.gen(function* () {
		// 1. Get security config (strict, immutable)
		const config = getSecurityConfig();
		const findings: Finding[] = [];

		// 2. Scan package.json scripts (SEC011)
		const packageJsonPath = join(packageDir, "package.json");
		const scriptScanResult = scanPackageScripts(packageJsonPath);
		if (scriptScanResult.success && scriptScanResult.data) {
			findings.push(...scriptScanResult.data);
		}

		// 3. Discover source files (Effect-based, requires FileSystem)
		const filesResult = yield* findFilesToScan(packageDir);
		if (!filesResult.success) {
			return yield* Effect.fail(
				new SecurityError({
					message:
						filesResult.error?.message ?? "Failed to discover files to scan",
					userMessage: "Security scan failed",
				}),
			);
		}

		const files = filesResult.data || [];

		// 4. For each source file: read, build alias maps, scan
		for (const filePath of files) {
			const sourceText = yield* Effect.promise(() =>
				readFile(filePath, "utf-8"),
			);

			// Build alias maps
			const sourceFile = ts.createSourceFile(
				filePath,
				sourceText,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TSX,
			);
			const aliasMaps = buildAliasMaps(sourceFile);

			// Scan with engine + all enabled rules
			const fileFindings = scanFile(
				filePath,
				sourceText,
				RULES,
				config,
				aliasMaps,
			);
			findings.push(...fileFindings);
		}

		// 5. Sort findings by file, then line
		findings.sort((a, b) => {
			const fileCompare = a.file.localeCompare(b.file);
			if (fileCompare !== 0) return fileCompare;
			return a.line - b.line;
		});

		// 6. Build ScanReport
		const report: ScanReport = {
			findings,
			blocked: findings.some((f) => f.severity === "block"),
			summary: buildSummary(findings),
			scannedFiles: files.length,
		};

		return report;
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(
				"_tag" in error && error._tag === "SecurityError"
					? (error as SecurityError)
					: new SecurityError({
							message: error instanceof Error ? error.message : String(error),
							userMessage: "Security scan failed",
						}),
			),
		),
	);
}

/**
 * Build summary statistics from array of findings.
 *
 * Aggregates findings by:
 * - Total count
 * - Count per rule ID (SEC001, SEC002, etc.)
 * - Count per severity level (block, warn, off)
 *
 * @param findings - Array of security findings to summarize
 * @returns ScanSummary with aggregated statistics
 */
export function buildSummary(findings: Finding[]): ScanSummary {
	const summary: ScanSummary = {
		total: findings.length,
		byRuleId: {},
		bySeverity: {
			block: 0,
			warn: 0,
			off: 0,
		},
	};

	// Group by ruleId and severity
	for (const finding of findings) {
		// Count by ruleId
		if (!summary.byRuleId[finding.ruleId]) {
			summary.byRuleId[finding.ruleId] = 0;
		}
		summary.byRuleId[finding.ruleId]++;

		// Count by severity
		summary.bySeverity[finding.severity]++;
	}

	return summary;
}

/**
 * Format scan report for output.
 *
 * Supports two output formats:
 * - `text`: Human-readable format with color-coded severity levels, file paths, and snippets
 * - `json`: Machine-readable JSON format with complete report data
 *
 * @param report - Complete scan report to format
 * @param format - Output format type ('text' or 'json')
 * @returns Formatted string ready for console output or file writing
 */
export function formatFindings(
	report: ScanReport,
	format: ScanOutputFormat,
): string {
	if (format === "json") {
		return JSON.stringify(report, null, 2);
	}

	// Text format
	const lines: string[] = [];

	// Header
	lines.push("Security Scan Report");
	lines.push("===================");
	lines.push("");

	// Summary
	lines.push(`Scanned files: ${report.scannedFiles}`);
	lines.push(`Total findings: ${report.summary.total}`);
	lines.push(
		`Block: ${report.summary.bySeverity.block}, Warn: ${report.summary.bySeverity.warn}`,
	);
	lines.push(`Status: ${report.blocked ? "BLOCKED" : "PASSED"}`);
	lines.push("");

	// Findings
	if (report.findings.length === 0) {
		lines.push("No security issues found.");
	} else {
		lines.push("Findings:");
		lines.push("---------");

		for (const finding of report.findings) {
			const severityBadge =
				finding.severity === "block"
					? "[BLOCK]"
					: finding.severity === "warn"
						? "[WARN]"
						: "[INFO]";

			lines.push("");
			lines.push(`${severityBadge} ${finding.ruleId}: ${finding.message}`);
			lines.push(`  at ${finding.file}:${finding.line}:${finding.col}`);

			if (finding.snippet) {
				lines.push(`  > ${finding.snippet}`);
			}
		}
	}

	return lines.join("\n");
}

/**
 * Format security findings for deploy orchestrator.
 * Alias of formatFindings for compatibility with deployment plan.
 *
 * @param report - Complete scan report
 * @returns Formatted text output
 */
export function formatSecurityFindings(report: ScanReport): string {
	return formatFindings(report, "text");
}

/**
 * Scan bundled artifact(s) with regex-based patterns.
 * Detects malicious code in transitive dependencies that pre-bundle scan might miss.
 *
 * **Multi-file support**: Handles single file or array of files (code-split bundles).
 * Scans .js and .mjs extensions.
 *
 * @param artifactPaths - Path or array of paths to bundled .js/.mjs files
 * @returns Effect with ScanReport containing findings and block status
 */
export function scanBundleEffect(
	artifactPaths: string | string[],
): Effect.Effect<ScanReport, SecurityError, never> {
	return Effect.tryPromise({
		try: async () => {
			// 1. Normalize to array
			const paths = Array.isArray(artifactPaths)
				? artifactPaths
				: [artifactPaths];
			const allFindings: Finding[] = [];

			// 2. For each file: read content and scan
			for (const filePath of paths) {
				const content = await readFile(filePath, "utf-8");
				const fileFindings = scanBundleContent(content, BUNDLE_RULES, filePath);
				allFindings.push(...fileFindings);
			}

			// 3. Build ScanReport
			const report: ScanReport = {
				findings: allFindings,
				blocked: allFindings.some((f) => f.severity === "block"),
				summary: buildSummary(allFindings),
				scannedFiles: paths.length,
			};

			return report;
		},
		catch: (error) =>
			new SecurityError({
				message: error instanceof Error ? error.message : String(error),
				userMessage: "Bundle security scan failed",
			}),
	});
}
