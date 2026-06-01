import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM071VerifierContract,
  main,
  parseM071Args,
  type M071StatusCode,
} from "./verify-m071.ts";
import { ISSUE_131_DEFERRED_HANDOFF_ROWS, type Issue131DeferredHandoffRow } from "../src/issue-131/deferred-handoff.ts";
import type { Issue131SourcePath } from "../src/issue-131/evidence-matrix.ts";

const CURRENT_REVIEW_TS = [
  "import { validateGraphAmplifiedFindings, type GraphValidationFinding } from '../review-graph/validation.ts';",
  "import { buildReviewPlan, createDegradedReviewPlan, toReviewPlanDetailsSummary, type DegradedReviewPlan, type ReviewPlan } from '../review-orchestration/review-plan.ts';",
  "import { graphValidationAppliedRuntimeStatus, graphValidationGateForReviewPlan, graphValidationSkippedRuntimeStatus, graphValidationThrownRuntimeStatus, resolveGraphValidationPreStatus } from '../review-graph/graph-validation-status.ts';",
  "const graphValidationPreStatus = resolveGraphValidationPreStatus({ config, graphContextAvailable: Boolean(graphBlastRadius) });",
  "let reviewPlan: ReviewPlan | DegradedReviewPlan;",
  "try {",
  "  reviewPlan = reviewPlanBuilder({ task: { taskType: 'review.full', routingReason: 'standard' }, change: { changedFileCount: 1, linesChanged: 1, linesChangedSource: 'local-diff' }, gates: { current: [graphValidationGateForReviewPlan(graphValidationPreStatus).name], enabled: ['graph-validation'] }, policy: { publish: 'review-comment', tools: 'github-comment-tools', retry: 'budget-resilience' }, graphValidation: { status: graphValidationPreStatus.status, reason: graphValidationPreStatus.reason }, candidateFinding: { mode: 'preferred' } }).plan;",
  "} catch {",
  "  reviewPlan = createDegradedReviewPlan({ reason: 'builder-error', routingReason: 'standard' });",
  "}",
  "logger.info({ planHash: reviewPlan.hash }, 'ReviewPlan constructed before publication');",
  "const reviewPlanDetailsSummary = toReviewPlanDetailsSummary(reviewPlan);",
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

const PACKAGE_WITH_M071 = JSON.stringify({ scripts: { [COMMAND_NAME]: EXPECTED_PACKAGE_SCRIPT } });
const PACKAGE_WITHOUT_M071 = JSON.stringify({ scripts: { "verify:m070": "bun scripts/verify-m070.ts" } });
const PACKAGE_WEAK_M071 = JSON.stringify({ scripts: { [COMMAND_NAME]: "bun --bun scripts/verify-m071.ts" } });


function mutableHandoffRows(): Issue131DeferredHandoffRow[] {
  return ISSUE_131_DEFERRED_HANDOFF_ROWS.map((entry) => ({
    ...entry,
    requirementRefs: [...entry.requirementRefs],
    owner: { ...entry.owner },
  }));
}

function makeReaders(overrides: Partial<Record<Issue131SourcePath, string>> & { packageJson?: string } = {}) {
  const files: Record<Issue131SourcePath, string> = {
    "src/handlers/review.ts": CURRENT_REVIEW_TS,
    "src/review-orchestration/review-plan.ts": CURRENT_REVIEW_PLAN_TS,
    "src/lib/review-details-formatting.ts": "<summary>Review Details</summary>",
    "src/lib/review-details-plan-formatting.ts": CURRENT_REVIEW_UTILS_TS,
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
    expect(report.closure).toEqual({
      status: "complete",
      status_code: "m071_issue_131_matrix_ok",
      scope: "m071_foundation_only",
      issue_131_completion: "foundation_complete_followups_deferred",
      complete_foundation_row_ids: [
        "review-plan-contract",
        "normal-handler-plan-construction",
        "review-details-plan-summary",
        "typed-graph-validation-config",
        "truthful-graph-validation-status",
        "package-verifier-wiring",
      ],
      deferred_row_ids: [
        "candidate-finding-mcp-publication-bridge",
        "reducer-extraction",
        "specialist-lane-proof",
        "metrics-tier-closure",
      ],
      counts: { complete: 6, missing: 0, partial: 0, deferred: 4 },
      package_wiring: {
        script_name: "verify:m071",
        expected: "bun scripts/verify-m071.ts",
        present: true,
        matches: true,
      },
      failing_check_id: null,
    });
    expect(report.deferred_ownership).toEqual([
      { row_id: "candidate-finding-mcp-publication-bridge", status: "deferred", owner_milestone: "M072", owner_slice: "S01" },
      { row_id: "reducer-extraction", status: "deferred", owner_milestone: "M073", owner_slice: "S01" },
      { row_id: "specialist-lane-proof", status: "deferred", owner_milestone: "M074", owner_slice: "S01" },
      { row_id: "metrics-tier-closure", status: "deferred", owner_milestone: "M075", owner_slice: "S01" },
    ]);
    expect(row(report, "review-plan-contract").status).toBe("complete");
    expect(row(report, "normal-handler-plan-construction").status).toBe("complete");
    expect(row(report, "review-details-plan-summary").status).toBe("complete");
    expect(row(report, "typed-graph-validation-config").status).toBe("complete");
    expect(row(report, "truthful-graph-validation-status").status).toBe("complete");
    expect(row(report, "package-verifier-wiring").status).toBe("complete");
    expect(report.issues.join("\n")).not.toContain("rawPrompt");
  });


  test("emits compact handoff and R104 ownership in package verifier JSON", () => {
    const report = evaluateM071VerifierContract({
      generatedAt: "2026-05-10T00:00:00.000Z",
      ...makeReaders(),
    });

    expect(report.deferred_handoff.map((entry) => [entry.row_id, entry.owner_milestone, entry.owner_slice])).toEqual([
      ["candidate-finding-mcp-publication-bridge", "M072", "S01"],
      ["reducer-extraction", "M073", "S01"],
      ["specialist-lane-proof", "M074", "S01"],
      ["metrics-tier-closure", "M075", "S01"],
      ["repo-doctrine-contract-ownership", "M074", "S01"],
    ]);
    expect(report.r104_ownership).toMatchObject({
      requirement_ref: "R104",
      row_id: "repo-doctrine-contract-ownership",
      owner_milestone: "M074",
      owner_slice: "S01",
      owned_by_m071: false,
      resolution: "deferred_outside_m071",
    });
    expect(JSON.stringify(report.deferred_handoff)).not.toContain("rawPrompt");
    expect(JSON.stringify(report.deferred_handoff)).not.toContain("commentBody");
  });

  test("package verifier fails closed when handoff source ownership drifts", () => {
    const rows = mutableHandoffRows();
    rows[2] = { ...rows[2]!, owner: { milestone: "M075", slice: "S01" } };
    const report = evaluateM071VerifierContract({
      generatedAt: "x",
      ...makeReaders(),
      handoffRows: rows,
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M071-ISSUE-131-DEFERRED-OWNERSHIP");
    expect(report.checks.find((check) => check.id === "M071-ISSUE-131-DEFERRED-OWNERSHIP")?.detail).toContain("specialist-lane-proof: expected deferred owner M074/S01");
  });

  test("keeps non-planning source evidence paths in row evidence", () => {
    const report = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders() });
    const evidencePaths = report.rows.flatMap((entry) => entry.evidence.map((evidence) => evidence.path));

    expect(evidencePaths.length).toBeGreaterThan(0);
    expect(evidencePaths).toContain("src/handlers/review.ts");
    expect(evidencePaths).toContain("src/review-orchestration/review-plan.ts");
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
    expect(report.deferred_ownership.map((entry) => [entry.row_id, entry.owner_milestone, entry.owner_slice])).toEqual([
      ["candidate-finding-mcp-publication-bridge", "M072", "S01"],
      ["reducer-extraction", "M073", "S01"],
      ["specialist-lane-proof", "M074", "S01"],
      ["metrics-tier-closure", "M075", "S01"],
    ]);
  });

  test("human help and text output frame success as M071 foundation closure only", async () => {
    const help = await runMain(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("M071's issue #131 foundation is complete");
    expect(help.stdout).toContain("does not claim full issue #131 completion");

    const human = await runMain([]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("closure: complete (m071_foundation_only; foundation_complete_followups_deferred)");
    expect(human.stdout).toContain("candidate-finding-mcp-publication-bridge->M072/S01");
  });

  test("fails closed for absent package script and malformed package JSON", () => {
    const missing = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders({ packageJson: PACKAGE_WITHOUT_M071 }) });
    expect(missing.success).toBe(false);
    expect(missing.status_code).toBe("m071_issue_131_matrix_failed");
    expect(missing.packageWiring).toMatchObject({ present: false, matches: false });
    expect(missing.failing_check_id).toBe("M071-ISSUE-131-PACKAGE-WIRING");
    expect(missing.closure).toMatchObject({
      status: "failed",
      issue_131_completion: "not_closed",
      package_wiring: { present: false, matches: false },
      failing_check_id: "M071-ISSUE-131-PACKAGE-WIRING",
    });

    const malformed = evaluateM071VerifierContract({ generatedAt: "x", ...makeReaders({ packageJson: "{" }) });
    expect(malformed.success).toBe(false);
    expect(malformed.packageWiring).toMatchObject({ present: false, matches: false });
    expect(malformed.closure.package_wiring).toMatchObject({ present: false, matches: false });
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
        "src/review-orchestration/review-plan.ts": "",
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
    expect(parsed.closure.status).toBe("complete");
    expect(parsed.closure.scope).toBe("m071_foundation_only");
    expect(parsed.closure.issue_131_completion).toBe("foundation_complete_followups_deferred");
    expect(parsed.deferred_ownership.map((entry) => `${entry.row_id}:${entry.owner_milestone}/${entry.owner_slice}`)).toEqual([
      "candidate-finding-mcp-publication-bridge:M072/S01",
      "reducer-extraction:M073/S01",
      "specialist-lane-proof:M074/S01",
      "metrics-tier-closure:M075/S01",
    ]);
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

  test("main returns bounded invalid-arg JSON without raw argument spill", async () => {
    const unsafeArg = `--${"x".repeat(400)}rawPrompt`;
    const result = await runMain([unsafeArg]);
    const parsed = JSON.parse(result.stdout) as ReturnType<typeof evaluateM071VerifierContract>;

    expect(result.exitCode).toBe(2);
    expect(parsed.status_code).toBe("m071_invalid_arg");
    expect(parsed.closure).toMatchObject({
      status: "failed",
      scope: "m071_foundation_only",
      issue_131_completion: "not_closed",
      complete_foundation_row_ids: [],
      deferred_row_ids: [],
    });
    expect(parsed.issues[0]?.length).toBeLessThanOrEqual(240);
    expect(result.stdout).not.toContain("rawPrompt");
    expect(result.stderr).not.toContain("rawPrompt");
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
