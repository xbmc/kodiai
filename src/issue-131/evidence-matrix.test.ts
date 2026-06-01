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
import { ISSUE_131_DEFERRED_HANDOFF_ROWS, type Issue131DeferredHandoffRow } from "./deferred-handoff.ts";

const CURRENT_REVIEW_TS = [
  "import { validateGraphAmplifiedFindings, type GraphValidationFinding } from '../review-graph/validation.ts';",
  "import { buildReviewPlanPublicationContext, type ReviewPlan } from '../review-orchestration/review-plan.ts';",
  "import { graphValidationAppliedRuntimeStatus, graphValidationGateForReviewPlan, graphValidationSkippedRuntimeStatus, graphValidationThrownRuntimeStatus, resolveGraphValidationPreStatus } from '../review-graph/graph-validation-status.ts';",
  "const graphValidationPreStatus = resolveGraphValidationPreStatus({ config, graphContextAvailable: Boolean(graphBlastRadius) });",
  "const { plan: reviewPlan, detailsSummary: reviewPlanDetailsSummary } = buildReviewPlanPublicationContext({ input: { task: { taskType: 'review.full', routingReason: 'standard' }, change: { changedFileCount: 1, linesChanged: 1, linesChangedSource: 'local-diff' }, gates: { current: [graphValidationGateForReviewPlan(graphValidationPreStatus).name], enabled: ['graph-validation'] }, policy: { publish: 'review-comment', tools: 'github-comment-tools', retry: 'budget-resilience' }, graphValidation: { status: graphValidationPreStatus.status, reason: graphValidationPreStatus.reason }, candidateFinding: { mode: 'preferred' } }, builder: reviewPlanBuilder, degraded: { reason: 'builder-error', routingReason: 'standard' } });",
  "logger.info({ planHash: reviewPlan.hash }, 'ReviewPlan constructed before publication');",
  "const reviewDetailsBody = formatReviewDetailsSummary({ analyzedFiles: 1, reviewPlan: reviewPlanDetailsSummary });",
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
  "export type ReviewPlan = { status: 'ready'; hash: string; task: { taskType: string; routingReason: string }; change: { changedFileCount: number; linesChanged: number; linesChangedSource: string }; budget: unknown; gates: { current: string[]; enabled: string[] }; policy: { publish: string }; graphValidation: { status: string }; candidateFinding: { mode: string }; repoDoctrine: unknown };",
  "export type DegradedReviewPlan = { status: 'degraded'; hash: string; degraded: { reason: string }; task: { routingReason?: string }; graphValidation: { status: 'skipped' }; candidateFinding: { mode: 'unavailable' } };",
  "export type ReviewPlanDetailsSummary = { label: 'Review plan'; text: string; status: 'ready' | 'degraded'; hash: string };",
  "function hashCanonical(value: unknown) { return 'review-plan:v1:abc'; }",
  "function sanitizeSummaryToken(value: unknown) { return String(value ?? '').slice(0, 80); }",
  "function boundSummary(value: string) { return value.slice(0, 500); }",
  "export function buildReviewPlan(input: unknown): { status: 'ready'; plan: ReviewPlan } { return { status: 'ready', plan: { status: 'ready', hash: hashCanonical(input), task: { taskType: 'review.full', routingReason: 'standard' }, change: { changedFileCount: 1, linesChanged: 1, linesChangedSource: 'local-diff' }, budget: {}, gates: { current: ['graph-validation'], enabled: ['graph-validation'] }, policy: { publish: 'review-comment' }, graphValidation: { status: 'enabled' }, candidateFinding: { mode: 'preferred' }, repoDoctrine: {} } }; }",
  "export function buildReviewPlanPublicationContext(input: { input: unknown; builder?: typeof buildReviewPlan; degraded: { reason: string; routingReason?: string } }) { try { const plan = (input.builder ?? buildReviewPlan)(input.input).plan; return { status: 'ready', plan, detailsSummary: toReviewPlanDetailsSummary(plan) }; } catch (error) { const plan = createDegradedReviewPlan(input.degraded); return { status: 'degraded', plan, detailsSummary: toReviewPlanDetailsSummary(plan), error }; } }",
  "export function createDegradedReviewPlan(input: { reason: string; routingReason?: string }): DegradedReviewPlan { return { status: 'degraded', hash: hashCanonical(input), degraded: { reason: input.reason }, task: { routingReason: input.routingReason }, graphValidation: { status: 'skipped' }, candidateFinding: { mode: 'unavailable' } }; }",
  "export function toReviewPlanDetailsSummary(plan: ReviewPlan | DegradedReviewPlan): ReviewPlanDetailsSummary { return plan.status === 'degraded' ? { label: 'Review plan', status: 'degraded', hash: plan.hash, text: boundSummary(`Review plan: degraded hash=${plan.hash} route=unknown reason=${sanitizeSummaryToken(plan.degraded.reason)} graph=skipped candidates=unavailable doctrine=degraded/0/0/0`) } : { label: 'Review plan', status: 'ready', hash: plan.hash, text: boundSummary(`Review plan: ready hash=${plan.hash} route=${sanitizeSummaryToken(plan.task.routingReason)} task=${sanitizeSummaryToken(plan.task.taskType)} files=${plan.change.changedFileCount} lines=${plan.change.linesChanged}(local-diff) budget=na/900s gates=${plan.gates.current.length}/${plan.gates.enabled.length} publish=${sanitizeSummaryToken(plan.policy.publish)} graph=${plan.graphValidation.status} candidates=${plan.candidateFinding.mode} doctrine=applied/0/0/0`) }; }",
].join("\n");

const CURRENT_REVIEW_UTILS_TS = [
  "import type { ReviewPlanDetailsSummary } from '../review-orchestration/review-plan.ts';",
  "export function formatReviewPlanDetailsLine(reviewPlan?: ReviewPlanDetailsSummary | null): string[] { const text = typeof reviewPlan?.text === 'string' ? reviewPlan.text.trim().replace(/\\s+/g, ' ') : ''; return text ? [`- ${text}`] : []; }",
  "export function formatReviewDetailsSummary(params: { reviewPlan?: ReviewPlanDetailsSummary | null }) { return `<summary>Review Details</summary>\\n${formatReviewPlanDetailsLine(params.reviewPlan).join('\\n')}`; }",
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
    "src/review-orchestration/review-plan.ts": CURRENT_REVIEW_PLAN_TS,
    "src/lib/review-details-formatting.ts": "<summary>Review Details</summary>",
    "src/lib/review-details-plan-formatting.ts": CURRENT_REVIEW_UTILS_TS,
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


function mutableHandoffRows(): Issue131DeferredHandoffRow[] {
  return ISSUE_131_DEFERRED_HANDOFF_ROWS.map((entry) => ({
    ...entry,
    requirementRefs: [...entry.requirementRefs],
    owner: { ...entry.owner },
  }));
}

function evaluateFixtureWithHandoff(handoffRows: readonly Issue131DeferredHandoffRow[]) {
  const files: Record<Issue131SourcePath, string> = {
    "src/handlers/review.ts": CURRENT_REVIEW_TS,
    "src/review-orchestration/review-plan.ts": CURRENT_REVIEW_PLAN_TS,
    "src/lib/review-details-formatting.ts": "<summary>Review Details</summary>",
    "src/lib/review-details-plan-formatting.ts": CURRENT_REVIEW_UTILS_TS,
    "src/execution/config.ts": CURRENT_CONFIG_TS,
    "src/review-graph/validation.ts": CURRENT_VALIDATION_TS,
    "src/review-graph/graph-validation-status.ts": CURRENT_GRAPH_VALIDATION_STATUS_TS,
    "package.json": JSON.stringify({ scripts: { "verify:m071": "bun scripts/verify-m071.ts --json" } }),
  };
  return evaluateIssue131EvidenceMatrix({
    generatedAt: "2026-05-10T00:00:00.000Z",
    readFileText: (path) => files[path],
    readPackageJsonText: () => files["package.json"],
    handoffRows,
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
    expect(row(report, "review-plan-contract").evidence.map((entry) => entry.path)).toEqual(["src/review-orchestration/review-plan.ts"]);
    expect(row(report, "normal-handler-plan-construction").evidence.map((entry) => entry.path)).toEqual(["src/handlers/review.ts"]);
    expect(row(report, "review-details-plan-summary").status).toBe("complete");
    expect(row(report, "review-details-plan-summary").evidence.map((entry) => entry.path)).toEqual([
        "src/review-orchestration/review-plan.ts",
        "src/lib/review-details-plan-formatting.ts",
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
      "src/review-orchestration/review-plan.ts",
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


  test("projects compact source handoff and R104 ownership resolution", () => {
    const report = evaluateFixture({
      packageJson: JSON.stringify({ scripts: { "verify:m071": "bun scripts/verify-m071.ts --json" } }),
    });

    expect(report.deferred_handoff.map((entry) => [entry.row_id, entry.requirement_refs, entry.owner_milestone, entry.owner_slice])).toEqual([
      ["candidate-finding-mcp-publication-bridge", ["R130"], "M072", "S01"],
      ["reducer-extraction", ["R130", "R132"], "M073", "S01"],
      ["specialist-lane-proof", ["R131", "R104"], "M074", "S01"],
      ["metrics-tier-closure", ["R133"], "M075", "S01"],
      ["repo-doctrine-contract-ownership", ["R104"], "M074", "S01"],
    ]);
    expect(report.deferred_handoff.every((entry) => entry.proof_required.trim().length > 20)).toBe(true);
    expect(report.r104_ownership).toEqual({
      requirement_ref: "R104",
      row_id: "repo-doctrine-contract-ownership",
      owner_milestone: "M074",
      owner_slice: "S01",
      owned_by_m071: false,
      resolution: "deferred_outside_m071",
    });
  });

  test("fails closed when a source handoff row is missing", () => {
    const report = evaluateFixtureWithHandoff(mutableHandoffRows().filter((entry) => entry.rowId !== "metrics-tier-closure"));

    expect(report.success).toBe(false);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-DEFERRED-OWNERSHIP")?.passed).toBe(false);
    expect(report.issues.join("\n")).toContain("metrics-tier-closure: handoff row is missing");
  });

  test("fails closed when source handoff owner drifts from exact M072-M075 contract", () => {
    const rows = mutableHandoffRows();
    rows[0] = { ...rows[0]!, owner: { milestone: "M073", slice: "S01" } };
    const report = evaluateFixtureWithHandoff(rows);

    expect(report.success).toBe(false);
    expect(row(report, "candidate-finding-mcp-publication-bridge").deferredTo).toMatchObject({ milestone: "M073", slice: "S01" });
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-DEFERRED-OWNERSHIP")?.detail).toContain("expected deferred owner M072/S01");
  });

  test("fails closed when R104 remains assigned to M071", () => {
    const rows = mutableHandoffRows();
    rows[4] = { ...rows[4]!, owner: { milestone: "M071" as never, slice: "S06" } };
    const report = evaluateFixtureWithHandoff(rows);

    expect(report.success).toBe(false);
    expect(report.r104_ownership).toMatchObject({ owner_milestone: "M071", owned_by_m071: true, resolution: "unsafe_m071_owner" });
    expect(report.issues.join("\n")).toContain("R104 must not be owned by M071");
  });

  test("fails closed when source handoff contains unsafe report fields or empty proof text", () => {
    const unsafeRows = mutableHandoffRows() as Array<Issue131DeferredHandoffRow & { rawDiff?: string }>;
    unsafeRows[1] = { ...unsafeRows[1]!, proofRequiredBeforePromotion: "   ", rawDiff: "not allowed" };
    const report = evaluateFixtureWithHandoff(unsafeRows);

    expect(report.success).toBe(false);
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-DEFERRED-OWNERSHIP")?.passed).toBe(false);
    expect(report.issues.join("\n")).toContain("proof required before promotion is required");
    expect(report.issues.join("\n")).toContain("Forbidden raw handoff fields detected");
  });

  test("fails closed when ReviewPlan words appear without normal-path construction before publication", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": [
        "type LocalNote = 'ReviewPlan';",
        "async function publish() { await octokit.rest.pulls.createReview({ body: 'done' }); }",
        "// ReviewPlan is mentioned in prose only after publication.",
      ].join("\n"),
      "src/review-orchestration/review-plan.ts": "",
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
        "import { buildReviewPlan, toReviewPlanDetailsSummary, type ReviewPlan } from '../review-orchestration/review-plan.ts';",
        "await octokit.rest.issues.createComment({ body: 'published first' });",
        "const reviewPlan = reviewPlanBuilder({});",
        "logger.info({ planHash: reviewPlan.hash }, 'ReviewPlan constructed');",
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
      "src/review-orchestration/review-plan.ts": CURRENT_REVIEW_PLAN_TS.replace("export function toReviewPlanDetailsSummary", "function toReviewPlanDetailsSummary"),
    });

    expect(row(handlerOnly, "review-details-plan-summary").status).toBe("partial");
    expect(row(handlerOnly, "review-details-plan-summary").failureReasons.join("\n")).toContain("No source-owned ReviewPlan-to-Review Details line projection");
  });

  test("does not accept ReviewPlan plan-summary naming that exists only in comments or tests", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": [
        "// reviewPlan: reviewPlanDetailsSummary",
        "// toReviewPlanDetailsSummary(reviewPlan)",
        "// createDegradedReviewPlan({ reason: 'builder-error' })",
        "const marker = '<summary>Review Details</summary>';",
        "const reviewDetailsBody = formatReviewDetailsSummary({});",
      ].join("\n"),
    });

    expect(row(report, "review-details-plan-summary").status).toBe("partial");
    expect(row(report, "review-details-plan-summary").failureReasons.join("\n")).toContain("Review handler does not derive");
  });

  test("rejects disconnected degraded-plan tokens that are not bounded fail-open wiring", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": [
        "import { buildReviewPlan, createDegradedReviewPlan, toReviewPlanDetailsSummary, type ReviewPlan } from '../review-orchestration/review-plan.ts';",
        "const reviewPlan = reviewPlanBuilder({ task: { taskType: 'review.full' } }).plan;",
        "const unrelated = 'builder-error';",
        "function unused() { return createDegradedReviewPlan({ reason: 'other-error', routingReason: 'standard' }); }",
        "const reviewPlanDetailsSummary = toReviewPlanDetailsSummary(reviewPlan);",
        "const reviewDetailsBody = formatReviewDetailsSummary({ analyzedFiles: 1, reviewPlan: reviewPlanDetailsSummary });",
        "const marker = '<summary>Review Details</summary>';",
      ].join("\n"),
    });

    expect(row(report, "review-details-plan-summary").status).toBe("partial");
    expect(row(report, "review-details-plan-summary").failureReasons.join("\n")).toContain("bounded fail-open ReviewPlan degradation behavior");
  });

  test("accepts ReviewPlan details wiring without coupling to the local summary variable name", () => {
    const report = evaluateFixture({
      "src/handlers/review.ts": [
        "import { buildReviewPlanPublicationContext, type ReviewPlan } from '../review-orchestration/review-plan.ts';",
        "const publicationContext = buildReviewPlanPublicationContext({ input: { task: { taskType: 'review.full' } }, builder: reviewPlanBuilder, degraded: { reason: 'builder-error', routingReason: 'standard' } });",
        "const plan = publicationContext.plan;",
        "const publicPlanDetails = publicationContext.detailsSummary;",
        "const reviewDetailsBody = formatReviewDetailsSummary({ analyzedFiles: 1, reviewPlan: publicPlanDetails });",
        "const marker = '<summary>Review Details</summary>';",
      ].join("\n"),
    });

    expect(row(report, "review-details-plan-summary").status).toBe("complete");
  });

  test("keeps runtime lib modules from importing issue-specific proof modules", async () => {
    const runtimeFormatterSource = await Bun.file("src/lib/review-details-candidate-formatting.ts").text();

    expect(runtimeFormatterSource).not.toContain("../issue-131/");
    expect(runtimeFormatterSource).not.toContain("../issue-131");
  });

  test("fails S03 evidence when Review Plan formatter visible output contains raw canary names", () => {
    const unsafeFormatter = CURRENT_REVIEW_UTILS_TS.replace(
      "return text ? [`- ${text}`] : [];",
      "return text ? [`- rawPrompt=${text}`] : [];",
    );
    const report = evaluateFixture({ "src/lib/review-details-plan-formatting.ts": unsafeFormatter });

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
