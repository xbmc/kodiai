import { describe, expect, test } from "bun:test";

import {
  ISSUE_131_CHECK_IDS,
  ISSUE_131_ROW_IDS,
  ISSUE_131_STATUSES,
  evaluateIssue131EvidenceMatrix,
  findForbiddenReportFields,
  validateIssue131EvidencePath,
  type Issue131SourcePath,
} from "./evidence-matrix.ts";

const CURRENT_REVIEW_TS = [
  "import { validateGraphAmplifiedFindings, type GraphValidationFinding } from '../review-graph/validation.ts';",
  "import { buildReviewPlan, summarizeReviewPlanForDiagnostics, type ReviewPlan } from '../review-plan/review-plan.ts';",
  "const reviewDetailsBody = formatReviewDetailsSummary({ analyzedFiles: 1 });",
  "const marker = '<summary>Review Details</summary>';",
  "const reviewPlan = reviewPlanBuilder({ route: { kind: 'pull_request' }, scope: { changedFileCount: 1, reviewedFileCount: 1, totalLinesChanged: 1 }, contextSources: [], gates: [], budgets: { maxComments: 7 }, publishPolicy: { mode: 'review-comment', autoApprove: false, publishReviewDetails: true, inlineComments: true, candidateVerificationRequired: false } });",
  "logger.info({ ...reviewPlanSummarizer(reviewPlan as ReviewPlan) }, 'ReviewPlan constructed before publication');",
  "if (graphBlastRadius && (config.review as Record<string, unknown> & { graphValidation?: { enabled?: boolean } }).graphValidation?.enabled) {",
  "  const validationResult = await validateGraphAmplifiedFindings(input, graphBlastRadius, llm, { enabled: true }, logger);",
  "  logger.info({ validatedCount: validationResult.validatedCount, confirmedCount: validationResult.confirmedCount, uncertainCount: validationResult.uncertainCount }, 'Graph validation applied');",
  "  processedFindings = processedFindings.map((f) => ({ ...f, graphValidationVerdict: 'skipped' }));",
  "}",
].join("\n");

const CURRENT_REVIEW_PLAN_TS = [
  "export type ReviewPlan = { version: 1; stableHash: string; route: unknown; scope: unknown; contextSources: readonly unknown[]; gates: readonly unknown[]; budgets: unknown; publishPolicy: unknown };",
  "export const REVIEW_PLAN_HASH_PREFIX = 'review-plan:v1:';",
  "export function buildReviewPlan(input: unknown): ReviewPlan { assertNoForbiddenRawFields(input); return { version: 1, stableHash: REVIEW_PLAN_HASH_PREFIX + 'abc', route: {}, scope: {}, contextSources: [], gates: [], budgets: {}, publishPolicy: {} }; }",
  "export function summarizeReviewPlanForDiagnostics(plan: ReviewPlan) { return { gate: 'review-plan', planHash: plan.stableHash }; }",
  "function assertNoForbiddenRawFields(value: unknown): void { void value; }",
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

const PACKAGE_WITHOUT_M071 = JSON.stringify({
  scripts: {
    "verify:m070": "bun scripts/verify-m070.ts",
  },
});

function evaluateFixture(overrides: Partial<Record<Issue131SourcePath, string>> & { packageJson?: string } = {}) {
  const files: Record<Issue131SourcePath, string> = {
    "src/handlers/review.ts": CURRENT_REVIEW_TS,
    "src/review-plan/review-plan.ts": CURRENT_REVIEW_PLAN_TS,
    "src/execution/config.ts": CURRENT_CONFIG_TS,
    "src/review-graph/validation.ts": CURRENT_VALIDATION_TS,
    "package.json": overrides.packageJson ?? PACKAGE_WITHOUT_M071,
    ...overrides,
  };

  return evaluateIssue131EvidenceMatrix({
    generatedAt: "2026-05-10T00:00:00.000Z",
    readFileText: (path) => files[path],
    readPackageJsonText: () => files["package.json"],
  });
}

function row(report: ReturnType<typeof evaluateFixture>, id: string) {
  const found = report.rows.find((entry) => entry.id === id);
  expect(found).toBeDefined();
  return found!;
}

describe("issue #131 evidence matrix evaluator", () => {
  test("exports the exact status taxonomy and stable row/check ids", () => {
    expect(ISSUE_131_STATUSES).toEqual(["complete", "partial", "missing", "deferred"]);
    expect(ISSUE_131_ROW_IDS).toEqual([
      "review-plan-contract",
      "normal-handler-plan-construction",
      "review-details-plan-summary",
      "typed-graph-validation-config",
      "truthful-graph-validation-status",
      "candidate-finding-mcp-publication-bridge",
      "reducer-extraction",
      "specialist-lane-proof",
      "metrics-tier-closure",
      "package-verifier-wiring",
    ]);
    expect(ISSUE_131_CHECK_IDS).toEqual([
      "M071-ISSUE-131-STATUS-TAXONOMY",
      "M071-ISSUE-131-EVIDENCE-PATHS",
      "M071-ISSUE-131-ROW-CLASSIFICATION",
      "M071-ISSUE-131-DEFERRED-OWNERSHIP",
      "M071-ISSUE-131-PACKAGE-WIRING",
      "M071-ISSUE-131-REPORT-SAFETY",
    ]);
  });

  test("validates repo-relative non-planning evidence paths", () => {
    expect(validateIssue131EvidencePath("src/handlers/review.ts")).toEqual({ valid: true });
    expect(validateIssue131EvidencePath("package.json")).toEqual({ valid: true });

    for (const forbidden of ["", "/tmp/review.ts", "../src/handlers/review.ts", ".gsd/milestones/M071/M071-CONTEXT.md", ".planning/notes.md", ".audits/report.md", "src\\handlers\\review.ts"]) {
      expect(validateIssue131EvidencePath(forbidden)).toMatchObject({ valid: false });
    }
  });

  test("classifies current S02 source evidence as complete while later slices stay fail-closed and package remains unwired", () => {
    const report = evaluateFixture();

    expect(report.command).toBe("verify:m071");
    expect(report.generatedAt).toBe("2026-05-10T00:00:00.000Z");
    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m071_issue_131_matrix_failed");
    expect(row(report, "review-plan-contract").status).toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).toBe("complete");
    expect(row(report, "review-plan-contract").evidence.map((entry) => entry.path)).toEqual(["src/review-plan/review-plan.ts"]);
    expect(row(report, "normal-handler-plan-construction").evidence.map((entry) => entry.path)).toEqual(["src/handlers/review.ts"]);
    expect(row(report, "review-details-plan-summary").status).toBe("partial");
    expect(row(report, "typed-graph-validation-config").status).toBe("partial");
    expect(row(report, "truthful-graph-validation-status").status).toBe("partial");
    expect(row(report, "package-verifier-wiring").status).toBe("missing");

    expect(row(report, "typed-graph-validation-config").evidence.map((entry) => entry.path)).toEqual([
      "src/handlers/review.ts",
      "src/review-graph/validation.ts",
    ]);
    expect(row(report, "typed-graph-validation-config").failureReasons.join("\n")).toContain("src/execution/config.ts does not expose typed review.graphValidation");
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-ROW-CLASSIFICATION")?.passed).toBe(true);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-PACKAGE-WIRING")?.passed).toBe(false);
  });

  test("requires deferred rows to name future owning milestones and slices", () => {
    const report = evaluateFixture();
    const deferred = report.rows.filter((entry) => entry.status === "deferred");

    expect(deferred).toHaveLength(4);
    expect(deferred.map((entry) => [entry.id, entry.deferredTo?.milestone, entry.deferredTo?.slice])).toEqual([
      ["candidate-finding-mcp-publication-bridge", "M072", "S01"],
      ["reducer-extraction", "M073", "S01"],
      ["specialist-lane-proof", "M074", "S01"],
      ["metrics-tier-closure", "M075", "S01"],
    ]);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-DEFERRED-OWNERSHIP")?.passed).toBe(true);
  });

  test("fails closed when ReviewPlan words appear without normal-path construction before publication", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": [
        "type LocalNote = 'ReviewPlan';",
        "async function publish() { await octokit.rest.pulls.createReview({ body: 'done' }); }",
        "// ReviewPlan is mentioned in prose only after publication.",
      ].join("\n"),
      "src/review-plan/review-plan.ts": "",
    });

    expect(row(report, "review-plan-contract").status).toBe("missing");
    expect(row(report, "normal-handler-plan-construction").status).toBe("partial");
    expect(row(report, "normal-handler-plan-construction").failureReasons.join("\n")).toContain("without a normal-path construction seam");
    expect(row(report, "review-details-plan-summary").status).toBe("missing");
  });

  test("keeps isolated ReviewPlan contract source from proving normal handler wiring", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": "const marker = '<summary>Review Details</summary>'; const reviewDetailsBody = formatReviewDetailsSummary({});",
    });

    expect(row(report, "review-plan-contract").status).toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).toBe("missing");
    expect(row(report, "review-details-plan-summary").status).toBe("partial");
  });

  test("rejects handler ReviewPlan construction after a nearby publication side effect", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": [
        "import { buildReviewPlan, summarizeReviewPlanForDiagnostics, type ReviewPlan } from '../review-plan/review-plan.ts';",
        "await octokit.rest.issues.createComment({ body: 'published first' });",
        "const reviewPlan = reviewPlanBuilder({});",
        "logger.info({ ...reviewPlanSummarizer(reviewPlan as ReviewPlan) }, 'ReviewPlan constructed');",
      ].join("\n"),
    });

    expect(row(report, "review-plan-contract").status).toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).toBe("partial");
    expect(row(report, "normal-handler-plan-construction").failureReasons.join("\n")).toContain("before publication");
  });

  test("does not upgrade graph-validation config to complete while handler uses an untyped cast", () => {
    const report = evaluateFixture({
      "src/execution/config.ts": "const graphValidationSchema = z.object({ enabled: z.boolean().default(false) }); const reviewSchema = z.object({ graphValidation: graphValidationSchema });",
    });

    expect(row(report, "typed-graph-validation-config").status).toBe("partial");
    expect(row(report, "typed-graph-validation-config").failureReasons.join("\n")).toContain("typed consumption");
  });

  test("can classify completed package wiring only when verify:m071 points at an M071 verifier", () => {
    const report = evaluateFixture({
      packageJson: JSON.stringify({ scripts: { "verify:m071": "bun scripts/verify-m071.ts" } }),
    });

    expect(row(report, "package-verifier-wiring").status).toBe("complete");
    expect(row(report, "package-verifier-wiring").evidence).toEqual([{ path: "package.json", reason: "package.json exposes verify:m071." }]);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-PACKAGE-WIRING")?.passed).toBe(true);
  });

  test("detects forbidden raw fields in report-shaped data", () => {
    expect(findForbiddenReportFields({ safe: { rows: [] } })).toEqual([]);
    expect(findForbiddenReportFields({ rows: [{ id: "x", commentBody: "raw comment" }], rawPrompt: "do work" })).toEqual([
      "$.rows[0].commentBody",
      "$.rawPrompt",
    ]);
  });
});
