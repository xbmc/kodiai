import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM071VerifierContract,
  main,
  parseM071Args,
  type M071StatusCode,
} from "./verify-m071.ts";
import type { Issue131SourcePath } from "../src/issue-131/evidence-matrix.ts";

const CURRENT_REVIEW_TS = [
  "import { validateGraphAmplifiedFindings, type GraphValidationFinding } from '../review-graph/validation.ts';",
  "const reviewDetailsBody = formatReviewDetailsSummary({ analyzedFiles: 1 });",
  "const marker = '<summary>Review Details</summary>';",
  "if (graphBlastRadius && (config.review as Record<string, unknown> & { graphValidation?: { enabled?: boolean } }).graphValidation?.enabled) {",
  "  const validationResult = await validateGraphAmplifiedFindings(input, graphBlastRadius, llm, { enabled: true }, logger);",
  "  logger.info({ validatedCount: validationResult.validatedCount, confirmedCount: validationResult.confirmedCount, uncertainCount: validationResult.uncertainCount }, 'Graph validation applied');",
  "  processedFindings = processedFindings.map((f) => ({ ...f, graphValidationVerdict: 'skipped' }));",
  "}",
].join("\n");

const CURRENT_CONFIG_TS = [
  "const reviewSchema = z.object({",
  "  enabled: z.boolean().default(true),",
  "  maxComments: z.number().min(1).max(25).default(7),",
  "});",
].join("\n");

const CURRENT_VALIDATION_TS = [
  "// Fail-open validation module",
  "export type GraphValidationOptions = { enabled?: boolean; maxFindingsToValidate?: number };",
  "export type GraphValidationResult<T> = { findings: T[]; validatedCount: number; confirmedCount: number; uncertainCount: number; succeeded: boolean };",
].join("\n");

const PACKAGE_WITH_M071 = JSON.stringify({ scripts: { [COMMAND_NAME]: EXPECTED_PACKAGE_SCRIPT } });
const PACKAGE_WITHOUT_M071 = JSON.stringify({ scripts: { "verify:m070": "bun scripts/verify-m070.ts" } });
const PACKAGE_WEAK_M071 = JSON.stringify({ scripts: { [COMMAND_NAME]: "bun --bun scripts/verify-m071.ts" } });

function makeReaders(overrides: Partial<Record<Issue131SourcePath, string>> & { packageJson?: string } = {}) {
  const files: Record<Issue131SourcePath, string> = {
    "src/handlers/review.ts": CURRENT_REVIEW_TS,
    "src/execution/config.ts": CURRENT_CONFIG_TS,
    "src/review-graph/validation.ts": CURRENT_VALIDATION_TS,
    "package.json": overrides.packageJson ?? PACKAGE_WITH_M071,
    ...overrides,
  };
  return {
    readFileText: (path: Issue131SourcePath) => files[path],
    readPackageJsonText: () => files["package.json"],
  };
}

function row(report: ReturnType<typeof evaluateM071VerifierContract>, id: string) {
  const found = report.rows.find((entry) => entry.id === id);
  expect(found).toBeDefined();
  return found!;
}

function captureWriters() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk: string) => { stdout += chunk; } },
    stderr: { write: (chunk: string) => { stderr += chunk; } },
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; },
  };
}

async function runMain(argv: readonly string[], packageJson: string = PACKAGE_WITH_M071) {
  const writers = captureWriters();
  const readers = makeReaders({ packageJson });
  const exitCode = await main(argv, {
    ...writers,
    generatedAt: "2026-05-10T00:00:00.000Z",
    readFileText: readers.readFileText,
    readPackageJsonText: readers.readPackageJsonText,
  });
  return { exitCode, stdout: writers.stdoutText, stderr: writers.stderrText };
}

describe("verify:m071 CLI", () => {
  test("parses json, help, and expected status args", () => {
    expect(parseM071Args(["--json", "--expect-status", "m071_issue_131_matrix_ok"])).toEqual({
      json: true,
      help: false,
      expectStatus: "m071_issue_131_matrix_ok",
    });
    expect(parseM071Args(["--help"])).toEqual({ json: false, help: true, expectStatus: null });
    expect(() => parseM071Args(["--scenario", "x"])).toThrow("unsupported argument");
    expect(() => parseM071Args(["--expect-status", "m071_unknown" as M071StatusCode])).toThrow("--expect-status must be one of");
  });

  test("emits stable safe JSON report shape for the current truthful matrix", () => {
    const report = evaluateM071VerifierContract({
      generatedAt: "2026-05-10T00:00:00.000Z",
      ...makeReaders(),
    });

    expect(report.command).toBe("verify:m071");
    expect(report.generated_at).toBe("2026-05-10T00:00:00.000Z");
    expect(report.proofMode).toBe("repo-source-evidence-matrix");
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m071_issue_131_matrix_ok");
    expect(report.check_ids).toEqual([
      "M071-ISSUE-131-STATUS-TAXONOMY",
      "M071-ISSUE-131-EVIDENCE-PATHS",
      "M071-ISSUE-131-ROW-CLASSIFICATION",
      "M071-ISSUE-131-DEFERRED-OWNERSHIP",
      "M071-ISSUE-131-PACKAGE-WIRING",
      "M071-ISSUE-131-REPORT-SAFETY",
    ]);
    expect(report.packageWiring).toEqual({
      scriptName: "verify:m071",
      expected: "bun scripts/verify-m071.ts",
      present: true,
      matches: true,
    });
    expect(report.counts).toMatchObject({ missing: 2, partial: 3, deferred: 4 });
    expect(row(report, "review-plan-contract").status).toBe("missing");
    expect(row(report, "typed-graph-validation-config").status).toBe("partial");
    expect(row(report, "package-verifier-wiring").status).toBe("complete");
    expect(report.issues.join("\n")).not.toContain("rawPrompt");
  });

  test("keeps non-planning source evidence paths in row evidence", () => {
    const report = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders() });
    const evidencePaths = report.rows.flatMap((entry) => entry.evidence.map((evidence) => evidence.path));

    expect(evidencePaths.length).toBeGreaterThan(0);
    expect(evidencePaths).toContain("src/handlers/review.ts");
    expect(evidencePaths).toContain("src/review-graph/validation.ts");
    expect(evidencePaths).toContain("package.json");
    expect(evidencePaths.every((path) => !path.startsWith(".gsd/") && !path.startsWith(".planning/") && !path.startsWith(".audits/"))).toBe(true);
  });

  test("requires deferred rows to keep explicit ownership fields", () => {
    const report = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders() });
    expect(report.rows.filter((entry) => entry.status === "deferred").map((entry) => [entry.id, entry.deferredTo?.milestone, entry.deferredTo?.slice])).toEqual([
      ["candidate-finding-mcp-publication-bridge", "M072", "S01"],
      ["reducer-extraction", "M073", "S01"],
      ["specialist-lane-proof", "M074", "S01"],
      ["metrics-tier-closure", "M075", "S01"],
    ]);
  });

  test("fails closed for absent package script and malformed package JSON", () => {
    const missing = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders({ packageJson: PACKAGE_WITHOUT_M071 }) });
    expect(missing.success).toBe(false);
    expect(missing.status_code).toBe("m071_issue_131_matrix_failed");
    expect(missing.packageWiring).toMatchObject({ present: false, matches: false });
    expect(missing.failing_check_id).toBe("M071-ISSUE-131-PACKAGE-WIRING");

    const malformed = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders({ packageJson: "{" }) });
    expect(malformed.success).toBe(false);
    expect(malformed.packageWiring).toMatchObject({ present: false, matches: false });
    expect(malformed.issues.join("\n")).toContain("package.json scripts.verify:m071 must equal bun scripts/verify-m071.ts");
  });

  test("fails weak package evidence unless script exactly matches package wiring contract", () => {
    const report = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders({ packageJson: PACKAGE_WEAK_M071 }) });

    expect(row(report, "package-verifier-wiring").status).toBe("complete");
    expect(report.packageWiring).toMatchObject({ present: true, matches: false });
    expect(report.success).toBe(false);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-PACKAGE-WIRING")?.passed).toBe(false);
  });

  test("does not mark absent ReviewPlan or untyped review.graphValidation complete", () => {
    const report = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders() });

    expect(row(report, "review-plan-contract").status).not.toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).not.toBe("complete");
    expect(row(report, "typed-graph-validation-config").status).not.toBe("complete");
    expect(row(report, "typed-graph-validation-config").failureReasons.join("\n")).toContain("src/execution/config.ts does not expose typed review.graphValidation");
  });

  test("main exits zero for valid fail-closed JSON and prints bounded JSON", async () => {
    const result = await runMain(["--json"]);
    const parsed = JSON.parse(result.stdout) as ReturnType<typeof evaluateM071VerifierContract>;

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parsed.status_code).toBe("m071_issue_131_matrix_ok");
    expect(parsed.rows.some((entry) => entry.status === "missing")).toBe(true);
    expect(parsed.rows.some((entry) => entry.status === "partial")).toBe(true);
    expect(parsed.rows.some((entry) => entry.status === "deferred")).toBe(true);
    expect(result.stdout).not.toContain("rawPrompt");
    expect(result.stdout).not.toContain("rawModelOutput");
    expect(result.stdout).not.toContain("commentBody");
    expect(result.stdout).not.toContain("rawDiff");
  });

  test("main returns non-zero for mismatched expected status and zero when failure is expected", async () => {
    const mismatch = await runMain(["--json", "--expect-status", "m071_issue_131_matrix_failed"]);
    expect(mismatch.exitCode).toBe(1);
    expect(mismatch.stderr).toContain("expected status m071_issue_131_matrix_failed but got m071_issue_131_matrix_ok");

    const expectedFailure = await runMain(["--json", "--expect-status", "m071_issue_131_matrix_failed"], PACKAGE_WITHOUT_M071);
    expect(expectedFailure.exitCode).toBe(0);
    expect(JSON.parse(expectedFailure.stdout).success).toBe(false);
  });
});
