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
  "import { buildReviewPlan, summarizeReviewPlanForDiagnostics, summarizeReviewPlanForReviewDetails, type ReviewPlan } from '../review-plan/review-plan.ts';",
  "import { graphValidationAppliedRuntimeStatus, graphValidationGateForReviewPlan, graphValidationSkippedRuntimeStatus, graphValidationThrownRuntimeStatus, resolveGraphValidationPreStatus } from '../review-graph/graph-validation-status.ts';",
  "const graphValidationPreStatus = resolveGraphValidationPreStatus({ config, graphContextAvailable: Boolean(graphBlastRadius) });",
  "const reviewPlan = reviewPlanBuilder({ route: { kind: 'pull_request' }, scope: { changedFileCount: 1, reviewedFileCount: 1, totalLinesChanged: 1 }, contextSources: [], gates: [graphValidationGateForReviewPlan(graphValidationPreStatus)], budgets: { maxComments: 7 }, publishPolicy: { mode: 'review-comment', autoApprove: false, publishReviewDetails: true, inlineComments: true, candidateVerificationRequired: false } });",
  "logger.info({ ...reviewPlanSummarizer(reviewPlan as ReviewPlan) }, 'ReviewPlan constructed before publication');",
  "const reviewPlanReviewDetailsSummarizer = summarizeReviewPlanForReviewDetails;",
  "const buildReviewPlanReviewDetailsSummary = () => { try { return reviewPlanReviewDetailsSummarizer(reviewPlan); } catch (err) { logger.warn({ gate: 'review-plan', reason: 'review-details-projection-failed' }, 'ReviewPlan Review Details projection failed (fail-open, publishing without Review Plan line)'); return null; } };",
  "const reviewDetailsBody = formatReviewDetailsSummary({ analyzedFiles: 1, reviewPlanSummary: buildReviewPlanReviewDetailsSummary() });",
  "const marker = '<summary>Review Details</summary>';",
  "const skippedGraphValidationStatus = graphValidationSkippedRuntimeStatus({ config, graphContextAvailable: Boolean(graphBlastRadius), findingCount: processedFindings.length });",
  "if (skippedGraphValidationStatus) logger.info({ ...skippedGraphValidationStatus }, 'Graph-amplified finding validation skipped or unavailable');",
  "else if (graphBlastRadius) {",
  "  try {",
  "    const validationResult = await graphValidationRunner(graphValidationInput, graphBlastRadius, graphValidationLLM, config.review.graphValidation, logger);",
  "    const runtimeStatus = graphValidationAppliedRuntimeStatus({ result: validationResult, findingCount: processedFindings.length });",
  "    logger.info({ ...runtimeStatus }, 'Graph-amplified finding validation completed');",
  "    logger.warn({ ...runtimeStatus }, 'Graph-amplified finding validation failed (fail-open, continuing without validation)');",
  "  } catch { logger.warn({ ...graphValidationThrownRuntimeStatus({ findingCount: processedFindings.length }) }, 'Graph-amplified finding validation threw unexpectedly (fail-open)'); }",
  "}",
].join("\n");

const CURRENT_REVIEW_PLAN_TS = [
  "const GATE_STATUSES = ['enabled', 'applied', 'skipped', 'unavailable'] as const; export type ReviewPlanGateStatus = typeof GATE_STATUSES[number];",
  "export type ReviewPlan = { version: 1; stableHash: string; route: unknown; scope: unknown; contextSources: readonly unknown[]; gates: readonly unknown[]; budgets: unknown; publishPolicy: unknown };",
  "export type ReviewPlanReviewDetailsSummary = { gate: 'review-plan-review-details'; planHash: string; route: unknown; scope: unknown; contextSources: unknown; gates: unknown; budgets: unknown; publishPolicy: unknown };",
  "export const REVIEW_PLAN_HASH_PREFIX = 'review-plan:v1:';",
  "export function buildReviewPlan(input: unknown): ReviewPlan { assertNoForbiddenRawFields(input); return { version: 1, stableHash: REVIEW_PLAN_HASH_PREFIX + 'abc', route: {}, scope: {}, contextSources: [], gates: [], budgets: {}, publishPolicy: {} }; }",
  "export function summarizeReviewPlanForDiagnostics(plan: ReviewPlan) { return { gate: 'review-plan', planHash: plan.stableHash }; }",
  "export function summarizeReviewPlanForReviewDetails(plan: ReviewPlan): ReviewPlanReviewDetailsSummary { return { gate: 'review-plan-review-details', planHash: plan.stableHash, route: plan.route, scope: { ...plan.scope, omittedPathCount: 0 }, contextSources: { totalCount: 0, totalItemCount: 0, statusCounts: {}, representatives: [], omittedSourceCount: 0 }, gates: { totalCount: 0, totalFindingCount: 0, statusCounts: {}, representatives: [], omittedGateCount: 0 }, budgets: plan.budgets, publishPolicy: plan.publishPolicy }; }",
  "const MAX_PUBLIC_REVIEW_DETAILS = 4; function sanitizePublicReviewDetailsString(value: string) { return value.slice(0, MAX_PUBLIC_REVIEW_DETAILS); }",
  "function assertNoForbiddenRawFields(value: unknown): void { void value; }",
].join("\n");

const CURRENT_REVIEW_UTILS_TS = [
  "export type ReviewPlanReviewDetailsFormatterSummary = { planHash?: unknown; route?: unknown; scope?: unknown; contextSources?: unknown; gates?: unknown; budgets?: unknown; publishPolicy?: unknown };",
  "const REVIEW_PLAN_DETAILS_MAX_VALUE_LENGTH = 80;",
  "function sanitizeReviewPlanDetailsValue(value: unknown) { return typeof value === 'string' ? value.slice(0, REVIEW_PLAN_DETAILS_MAX_VALUE_LENGTH) : String(value ?? ''); }",
  "function formatReviewPlanDetailsRepresentativeList(value: unknown) { return Array.isArray(value) ? value.slice(0, 4).join(',') : 'none'; }",
  "function formatReviewPlanReviewDetailsLine(summary?: ReviewPlanReviewDetailsFormatterSummary | null): string | null {",
  "  if (!summary?.planHash) return null;",
  "  return `- Review Plan: hash=${sanitizeReviewPlanDetailsValue(summary.planHash)}; route=${sanitizeReviewPlanDetailsValue('pull_request')}; scope=1 changed/1 reviewed/1 lines; paths=${formatReviewPlanDetailsRepresentativeList([])}; contexts=0 sources/0 items/enabled:0; reps=none; gates=0 gates/0 findings/enabled:0; reps=none; budget=maxComments:7; publish=review-comment,autoApprove:n,details:y,inline:y,candidateVerification:n`;",
  "}",
  "export function formatReviewDetailsSummary(params: { reviewPlanSummary?: ReviewPlanReviewDetailsFormatterSummary | null }) { const line = formatReviewPlanReviewDetailsLine(params.reviewPlanSummary); return `<summary>Review Details</summary>\\n${line ?? ''}`; }",
].join("\n");

const CURRENT_CONFIG_TS = [
  "const graphValidationSchema = z.object({",
  "  enabled: z.boolean().default(false),",
  "  maxFindingsToValidate: z.number().int().min(1).max(100).default(10),",
  "  contextMaxChars: z.number().int().min(100).max(10000).default(1000),",
  "}).default({ enabled: false, maxFindingsToValidate: 10, contextMaxChars: 1000 });",
  "const reviewSchema = z.object({",
  "  enabled: z.boolean().default(true),",
  "  maxComments: z.number().min(1).max(25).default(7),",
  "  graphValidation: graphValidationSchema,",
  "}).default({ enabled: true, maxComments: 7, graphValidation: { enabled: false, maxFindingsToValidate: 10, contextMaxChars: 1000 } });",
].join("\n");

const CURRENT_VALIDATION_TS = [
  "// Fail-open validation module",
  "export type GraphValidationOptions = { enabled?: boolean; maxFindingsToValidate?: number };",
  "export type GraphValidationResult<T> = { findings: T[]; validatedCount: number; confirmedCount: number; uncertainCount: number; succeeded: boolean };",
].join("\n");

const CURRENT_GRAPH_VALIDATION_STATUS_TS = [
  "export const GRAPH_VALIDATION_GATE = 'graph-validation' as const;",
  "export type GraphValidationPreStatus = { gate: typeof GRAPH_VALIDATION_GATE; status: ReviewPlanGateStatus; reason: 'config-disabled' | 'graph-context-unavailable' | 'graph-context-available'; enabled: boolean; graphContextAvailable: boolean };",
  "export type GraphValidationRuntimeStatus = { gate: typeof GRAPH_VALIDATION_GATE; gateResult: 'skipped' | 'unavailable' | 'applied' | 'failure'; reason: 'config-disabled' | 'graph-context-unavailable' | 'validation-applied' | 'no-findings-validated' | 'validation-failed' | 'validation-threw'; enabled: boolean; graphContextAvailable: boolean; findingCount?: number; validatedCount?: number; confirmedCount?: number; uncertainCount?: number };",
  "export function resolveGraphValidationPreStatus() { return { gate: GRAPH_VALIDATION_GATE, status: 'enabled' as ReviewPlanGateStatus, reason: 'graph-context-available', enabled: true, graphContextAvailable: true }; }",
  "export function graphValidationGateForReviewPlan(status: GraphValidationPreStatus) { return { name: GRAPH_VALIDATION_GATE, status: status.status, reason: status.reason }; }",
  "export function graphValidationSkippedRuntimeStatus() { return { gate: GRAPH_VALIDATION_GATE, gateResult: preStatus.status === 'skipped' ? 'skipped' : 'unavailable', reason: 'config-disabled', enabled: false, graphContextAvailable: false }; }",
  "export function graphValidationAppliedRuntimeStatus(result: { succeeded: boolean }) { return result.succeeded ? { gate: GRAPH_VALIDATION_GATE, gateResult: 'applied', reason: 'validation-applied', enabled: true, graphContextAvailable: true, findingCount: 1, validatedCount: 1, confirmedCount: 1, uncertainCount: 0 } : { gate: GRAPH_VALIDATION_GATE, gateResult: 'failure', reason: 'validation-failed', enabled: true, graphContextAvailable: true, findingCount: 1, validatedCount: 0, confirmedCount: 0, uncertainCount: 0 }; }",
  "export function graphValidationThrownRuntimeStatus() { return { gate: GRAPH_VALIDATION_GATE, gateResult: 'failure', reason: 'validation-threw', enabled: true, graphContextAvailable: true }; }",
  "const noFindings = 'no-findings-validated';",
].join("\n");

const PACKAGE_WITH_M071 = JSON.stringify({ scripts: { [COMMAND_NAME]: EXPECTED_PACKAGE_SCRIPT } });
const PACKAGE_WITHOUT_M071 = JSON.stringify({ scripts: { "verify:m070": "bun scripts/verify-m070.ts" } });
const PACKAGE_WEAK_M071 = JSON.stringify({ scripts: { [COMMAND_NAME]: "bun --bun scripts/verify-m071.ts" } });

function makeReaders(overrides: Partial<Record<Issue131SourcePath, string>> & { packageJson?: string } = {}) {
  const files: Record<Issue131SourcePath, string> = {
    "src/handlers/review.ts": CURRENT_REVIEW_TS,
    "src/review-plan/review-plan.ts": CURRENT_REVIEW_PLAN_TS,
    "src/lib/review-utils.ts": CURRENT_REVIEW_UTILS_TS,
    "src/execution/config.ts": CURRENT_CONFIG_TS,
    "src/review-graph/validation.ts": CURRENT_VALIDATION_TS,
    "src/review-graph/graph-validation-status.ts": CURRENT_GRAPH_VALIDATION_STATUS_TS,
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
    expect(report.counts).toMatchObject({ complete: 6, missing: 0, partial: 0, deferred: 4 });
    expect(row(report, "review-plan-contract").status).toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).toBe("complete");
    expect(row(report, "review-details-plan-summary").status).toBe("complete");
    expect(row(report, "typed-graph-validation-config").status).toBe("complete");
    expect(row(report, "truthful-graph-validation-status").status).toBe("complete");
    expect(row(report, "package-verifier-wiring").status).toBe("complete");
    expect(report.issues.join("\n")).not.toContain("rawPrompt");
  });

  test("keeps non-planning source evidence paths in row evidence", () => {
    const report = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders() });
    const evidencePaths = report.rows.flatMap((entry) => entry.evidence.map((evidence) => evidence.path));

    expect(evidencePaths.length).toBeGreaterThan(0);
    expect(evidencePaths).toContain("src/handlers/review.ts");
    expect(evidencePaths).toContain("src/review-plan/review-plan.ts");
    expect(evidencePaths).toContain("src/review-graph/graph-validation-status.ts");
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

  test("does not mark absent ReviewPlan module or untyped review.graphValidation complete", () => {
    const report = evaluateM071VerifierContract({
      generatedAt: "x",
      ...makeReaders({
        "src/review-plan/review-plan.ts": "",
        "src/handlers/review.ts": "const marker = '<summary>Review Details</summary>'; const reviewDetailsBody = formatReviewDetailsSummary({});",
      }),
    });

    expect(row(report, "review-plan-contract").status).not.toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).not.toBe("complete");
    expect(row(report, "typed-graph-validation-config").status).not.toBe("complete");
    expect(row(report, "typed-graph-validation-config").failureReasons.join("\n")).toContain("Review handler does not consume config.review.graphValidation directly");
  });

  test("main exits zero for valid fail-closed JSON and prints bounded JSON", async () => {
    const result = await runMain(["--json"]);
    const parsed = JSON.parse(result.stdout) as ReturnType<typeof evaluateM071VerifierContract>;

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parsed.status_code).toBe("m071_issue_131_matrix_ok");
    expect(row(parsed, "review-plan-contract").status).toBe("complete");
    expect(row(parsed, "normal-handler-plan-construction").status).toBe("complete");
    expect(row(parsed, "review-details-plan-summary").status).toBe("complete");
    expect(row(parsed, "typed-graph-validation-config").status).toBe("complete");
    expect(row(parsed, "truthful-graph-validation-status").status).toBe("complete");
    expect(parsed.rows.some((entry) => entry.status === "partial")).toBe(false);
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
