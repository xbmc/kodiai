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

const PACKAGE_WITHOUT_M071 = JSON.stringify({
  scripts: {
    "verify:m070": "bun scripts/verify-m070.ts",
  },
});

function evaluateFixture(overrides: Partial<Record<Issue131SourcePath, string>> & { packageJson?: string } = {}) {
  const files: Record<Issue131SourcePath, string> = {
    "src/handlers/review.ts": CURRENT_REVIEW_TS,
    "src/review-plan/review-plan.ts": CURRENT_REVIEW_PLAN_TS,
    "src/lib/review-utils.ts": CURRENT_REVIEW_UTILS_TS,
    "src/execution/config.ts": CURRENT_CONFIG_TS,
    "src/review-graph/validation.ts": CURRENT_VALIDATION_TS,
    "src/review-graph/graph-validation-status.ts": CURRENT_GRAPH_VALIDATION_STATUS_TS,
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

  test("classifies current S02/S04 source evidence as complete while later slices stay deferred and package remains unwired", () => {
    const report = evaluateFixture();

    expect(report.command).toBe("verify:m071");
    expect(report.generatedAt).toBe("2026-05-10T00:00:00.000Z");
    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m071_issue_131_matrix_failed");
    expect(row(report, "review-plan-contract").status).toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).toBe("complete");
    expect(row(report, "review-plan-contract").evidence.map((entry) => entry.path)).toEqual(["src/review-plan/review-plan.ts"]);
    expect(row(report, "normal-handler-plan-construction").evidence.map((entry) => entry.path)).toEqual(["src/handlers/review.ts"]);
    expect(row(report, "review-details-plan-summary").status).toBe("complete");
    expect(row(report, "review-details-plan-summary").evidence.map((entry) => entry.path)).toEqual([
      "src/review-plan/review-plan.ts",
      "src/lib/review-utils.ts",
      "src/handlers/review.ts",
    ]);
    expect(row(report, "typed-graph-validation-config").status).toBe("complete");
    expect(row(report, "truthful-graph-validation-status").status).toBe("complete");
    expect(row(report, "package-verifier-wiring").status).toBe("missing");

    expect(row(report, "typed-graph-validation-config").evidence.map((entry) => entry.path)).toEqual([
      "src/execution/config.ts",
      "src/handlers/review.ts",
    ]);
    expect(row(report, "truthful-graph-validation-status").evidence.map((entry) => entry.path)).toEqual([
      "src/review-graph/graph-validation-status.ts",
      "src/handlers/review.ts",
      "src/review-plan/review-plan.ts",
    ]);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-ROW-CLASSIFICATION")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-ROW-CLASSIFICATION")?.detail).toContain("package-verifier-wiring");
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-PACKAGE-WIRING")?.passed).toBe(false);
  });

  test("passes final closure only with exact complete/deferred status counts and package wiring", () => {
    const report = evaluateFixture({
      packageJson: JSON.stringify({ scripts: { "verify:m071": "bun scripts/verify-m071.ts --json" } }),
    });

    expect(report.success).toBe(true);
    expect(report.statusCode).toBe("m071_issue_131_matrix_ok");
    expect(report.counts).toEqual({ complete: 6, partial: 0, missing: 0, deferred: 4 });
    expect(report.rows.map((entry) => [entry.id, entry.status])).toEqual([
      ["review-plan-contract", "complete"],
      ["normal-handler-plan-construction", "complete"],
      ["review-details-plan-summary", "complete"],
      ["typed-graph-validation-config", "complete"],
      ["truthful-graph-validation-status", "complete"],
      ["candidate-finding-mcp-publication-bridge", "deferred"],
      ["reducer-extraction", "deferred"],
      ["specialist-lane-proof", "deferred"],
      ["metrics-tier-closure", "deferred"],
      ["package-verifier-wiring", "complete"],
    ]);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-ROW-CLASSIFICATION")?.passed).toBe(true);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-DEFERRED-OWNERSHIP")?.passed).toBe(true);
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
    expect(row(report, "review-details-plan-summary").status).toBe("partial");
    expect(row(report, "review-details-plan-summary").failureReasons.join("\n")).toContain("Review handler does not");
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
        "import { buildReviewPlan, summarizeReviewPlanForDiagnostics, summarizeReviewPlanForReviewDetails, type ReviewPlan } from '../review-plan/review-plan.ts';",
        "await octokit.rest.issues.createComment({ body: 'published first' });",
        "const reviewPlan = reviewPlanBuilder({});",
        "logger.info({ ...reviewPlanSummarizer(reviewPlan as ReviewPlan) }, 'ReviewPlan constructed');",
      ].join("\n"),
    });

    expect(row(report, "review-plan-contract").status).toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).toBe("partial");
    expect(row(report, "normal-handler-plan-construction").failureReasons.join("\n")).toContain("before publication");
  });



  test("keeps public ReviewPlan projection partial until handler and formatter wiring are both source-proven", () => {
    const projectionOnly = evaluateFixture({
      "src/handlers/review.ts": "const marker = '<summary>Review Details</summary>'; const reviewDetailsBody = formatReviewDetailsSummary({});",
    });

    expect(row(projectionOnly, "review-details-plan-summary").status).toBe("partial");
    expect(row(projectionOnly, "review-details-plan-summary").failureReasons.join("\n")).toContain("Review handler does not derive");

    const handlerOnly = evaluateFixture({
      "src/review-plan/review-plan.ts": CURRENT_REVIEW_PLAN_TS.replace("export function summarizeReviewPlanForReviewDetails", "function summarizeReviewPlanForReviewDetails"),
    });

    expect(row(handlerOnly, "review-details-plan-summary").status).toBe("partial");
    expect(row(handlerOnly, "review-details-plan-summary").failureReasons.join("\n")).toContain("No source-owned ReviewPlan-to-Review Details summary projection");
  });

  test("does not accept ReviewPlan plan-summary naming that exists only in comments or tests", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": [
        "// reviewPlanSummary: buildReviewPlanReviewDetailsSummary()",
        "// reviewPlanReviewDetailsSummarizer(reviewPlan)",
        "const marker = '<summary>Review Details</summary>';",
        "const reviewDetailsBody = formatReviewDetailsSummary({});",
      ].join("\n"),
      "src/review-plan/review-plan.ts": "// summarizeReviewPlanForReviewDetails and ReviewPlanReviewDetailsSummary are test-only notes",
      "src/lib/review-utils.ts": "// formatReviewPlanReviewDetailsLine would render - Review Plan: hash= in tests",
    });

    expect(row(report, "review-details-plan-summary").status).toBe("partial");
    expect(row(report, "review-details-plan-summary").failureReasons.join("\n")).toContain("No exported ReviewPlanReviewDetailsSummary type");
  });

  test("fails S03 evidence when Review Plan formatter visible output contains raw canary names", () => {
    const unsafeFormatter = CURRENT_REVIEW_UTILS_TS.replace(
      "budget=maxComments:7; publish=review-comment",
      "rawPrompt=${sanitizeReviewPlanDetailsValue('rawPrompt')}; budget=maxComments:7; publish=review-comment",
    );
    const report = evaluateFixture({ "src/lib/review-utils.ts": unsafeFormatter });

    expect(row(report, "review-details-plan-summary").status).toBe("partial");
    expect(row(report, "review-details-plan-summary").failureReasons.join("\n")).toContain("raw review artifact field names");
  });

  test("does not upgrade graph-validation config to complete while handler uses an untyped cast", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": CURRENT_REVIEW_TS.replace(
        "config.review.graphValidation",
        "(config.review as Record<string, unknown> & { graphValidation?: { enabled?: boolean } }).graphValidation",
      ),
    });

    expect(row(report, "typed-graph-validation-config").status).toBe("partial");
    expect(row(report, "typed-graph-validation-config").failureReasons.join("\n")).toContain("old untyped graphValidation config cast");
  });

  test("keeps graph-validation config schema without typed handler consumption partial", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": "const unrelated = 'review handler without graph validation';",
    });

    expect(row(report, "typed-graph-validation-config").status).toBe("partial");
    expect(row(report, "typed-graph-validation-config").evidence.map((entry) => entry.path)).toContain("src/execution/config.ts");
    expect(row(report, "typed-graph-validation-config").failureReasons.join("\n")).toContain("Review handler does not consume config.review.graphValidation directly");
  });

  test("keeps graph-validation status strings without config schema partial", () => {
    const report = evaluateFixture({
      "src/execution/config.ts": "const reviewSchema = z.object({ enabled: z.boolean().default(true) });",
    });

    expect(row(report, "typed-graph-validation-config").status).toBe("partial");
    expect(row(report, "truthful-graph-validation-status").status).toBe("complete");
    expect(row(report, "typed-graph-validation-config").failureReasons.join("\n")).toContain("source-owned graphValidationSchema");
  });

  test("rejects graph-validation evidence that exists only in comments or inert strings", () => {
    const report = evaluateFixture({
      "src/execution/config.ts": [
        "// const graphValidationSchema = z.object({ enabled: z.boolean().default(false) });",
        "const note = 'graphValidation: graphValidationSchema enabled false maxFindingsToValidate contextMaxChars';",
      ].join("\n"),
      "src/handlers/review.ts": [
        "// graphValidationRunner(input, graphBlastRadius, llm, config.review.graphValidation, logger)",
        "const note = 'graphValidationSkippedRuntimeStatus graphValidationAppliedRuntimeStatus graphValidationThrownRuntimeStatus';",
      ].join("\n"),
      "src/review-graph/graph-validation-status.ts": [
        "// export const GRAPH_VALIDATION_GATE = 'graph-validation' as const;",
        "const note = 'GraphValidationRuntimeStatus skipped unavailable applied failure validatedCount confirmedCount uncertainCount';",
      ].join("\n"),
    });

    expect(row(report, "typed-graph-validation-config").status).not.toBe("complete");
    expect(row(report, "truthful-graph-validation-status").status).not.toBe("complete");
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
