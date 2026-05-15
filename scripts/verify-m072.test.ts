import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM072VerifierContract,
  main,
  parseM072Args,
  type M072SourcePath,
  type M072StatusCode,
} from "./verify-m072.ts";
import { ISSUE_131_DEFERRED_HANDOFF_ROWS, type Issue131DeferredHandoffRow } from "../src/issue-131/deferred-handoff.ts";

const BRIDGE_SOURCE = [
  'export const CANDIDATE_PUBLICATION_BRIDGE_VERSION = "candidate-publication-bridge.v1" as const;',
  'export function createCandidatePublicationBridgeRecord() { return { redactionFlags: { githubCommentBodyIncluded: false, reducerHandoffIncludesRawPayload: false } }; }',
  'export function projectCandidatePublicationReducerHandoffInput() { return null; }',
  'const ownerOk = row.owner.milestone === "M072" && row.owner.slice === "S01";',
].join("\n");

const REVIEW_HANDLER_BRIDGE_SOURCE = [
  'export const REVIEW_HANDLER_PUBLICATION_BRIDGE_SOURCE_LABEL = "review-handler-publication" as const;',
  'export type ReviewHandlerPublicationBridgeReviewDetails = { redaction: unknown };',
  'const log = { candidatePublicationBridgePrivateOnly: true };',
  'const redaction = { githubCommentBodyIncluded: false, reducerHandoffIncludesRawPayload: false };',
  'export function projectReviewHandlerCandidatePublicationBridgeEvidence() { return { log, redaction }; }',
].join("\n");

const DEFERRED_HANDOFF_SOURCE = [
  'const rowId = "candidate-finding-mcp-publication-bridge";',
  'const owner = { owner: { milestone: "M072", slice: "S01" } };',
  'const label = "M072/S01 candidate-publication bridge owner";',
  'export function findForbiddenDeferredHandoffFields() { return []; }',
  'export function validateIssue131DeferredHandoffRows() { return { passed: true, reasons: [] }; }',
].join("\n");

const INLINE_GATE_SOURCE = [
  'import { createCandidatePublicationBridgeRecord, projectCandidatePublicationReducerHandoffInput } from "../../issue-131/candidate-publication-bridge.ts";',
  'export function getCandidatePublicationBridgeCaptureState() { return { status: "captured" }; }',
  'export function evaluateInlineCandidatePublication() { return createCandidatePublicationBridgeRecord({ sourceLabel: "inline-mcp-review-comment" }); }',
  'const handoff = projectCandidatePublicationReducerHandoffInput({});',
].join("\n");

const INLINE_SERVER_SOURCE = [
  'function hasUnsafeBridgeRedactionFlags() { return false; }',
  'function evaluateBridgePublicationEvidence() { return "m072-candidate-publication-bridge"; }',
  'const reducer = "reducerHandoffIncludesRawPayload";',
  'const message = "Candidate verification or M072 bridge evidence denied inline review publication";',
].join("\n");

const HANDLER_SOURCE = [
  'import { projectReviewHandlerCandidatePublicationBridgeEvidence } from "../issue-131/review-handler-publication-bridge.ts";',
  'const gate = "m072-review-handler-publication-bridge";',
  'logger.info("Captured M072 review-handler candidate publication bridge before public publication");',
  'const reviewDetails = { candidatePublicationBridge: handlerCandidatePublicationBridge.reviewDetails };',
  'formatReviewDetailsSummary(reviewDetails);',
].join("\n");

const REVIEW_UTILS_SOURCE = [
  'function hasUnsafeBridgeRedaction() { return redaction.githubCommentBodyIncluded !== false || redaction.reducerHandoffIncludesRawPayload !== false; }',
  'function formatCandidatePublicationBridgeLine() { return "- M072 candidate publication bridge:"; }',
  'const failOpen = "Keep Review Details fail-open; malformed M072 bridge projections must not block publication";',
].join("\n");

const PACKAGE_WITH_M072 = JSON.stringify({ scripts: { [COMMAND_NAME]: EXPECTED_PACKAGE_SCRIPT } });
const PACKAGE_WITHOUT_M072 = JSON.stringify({ scripts: { "verify:m071": "bun scripts/verify-m071.ts" } });
const PACKAGE_WEAK_M072 = JSON.stringify({ scripts: { [COMMAND_NAME]: "bun --bun scripts/verify-m072.ts" } });

const CANARY_VALUES = [
  "prompt canary",
  "diff --git a/private b/private",
  "model output canary",
  "fingerprint canary",
  "BEGIN PRIVATE KEY",
  "github comment body",
  "raw candidate body",
  ".gsd/milestones/M072/slices/S04/tasks/T01-PLAN.md",
];

function mutableHandoffRows(): Issue131DeferredHandoffRow[] {
  return ISSUE_131_DEFERRED_HANDOFF_ROWS.map((entry) => ({
    ...entry,
    requirementRefs: [...entry.requirementRefs],
    owner: { ...entry.owner },
  }));
}

function makeReaders(overrides: Partial<Record<M072SourcePath, string>> & { packageJson?: string } = {}) {
  const files: Record<M072SourcePath, string> = {
    "src/issue-131/candidate-publication-bridge.ts": BRIDGE_SOURCE,
    "src/issue-131/review-handler-publication-bridge.ts": REVIEW_HANDLER_BRIDGE_SOURCE,
    "src/issue-131/deferred-handoff.ts": DEFERRED_HANDOFF_SOURCE,
    "src/execution/mcp/review-output-publication-gate.ts": INLINE_GATE_SOURCE,
    "src/execution/mcp/inline-review-server.ts": INLINE_SERVER_SOURCE,
    "src/handlers/review.ts": HANDLER_SOURCE,
    "src/lib/review-utils.ts": REVIEW_UTILS_SOURCE,
    "package.json": overrides.packageJson ?? PACKAGE_WITH_M072,
    ...overrides,
  };
  return {
    readFileText: (path: M072SourcePath) => files[path],
    readPackageJsonText: () => files["package.json"],
  };
}

function check(report: ReturnType<typeof evaluateM072VerifierContract>, id: string) {
  const found = report.checks.find((entry) => entry.id === id);
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

async function runMain(argv: readonly string[], packageJson: string = PACKAGE_WITH_M072) {
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

function expectNoCanaryLeak(report: unknown) {
  const json = JSON.stringify(report);
  for (const canary of CANARY_VALUES) {
    expect(json).not.toContain(canary);
  }
}

describe("verify:m072 CLI", () => {
  test("parses json, help, and expected status args", () => {
    expect(parseM072Args(["--json", "--expect-status", "m072_candidate_publication_bridge_ok"])).toEqual({
      json: true,
      help: false,
      expectStatus: "m072_candidate_publication_bridge_ok",
    });
    expect(parseM072Args(["--help"])).toEqual({ json: false, help: true, expectStatus: null });
    expect(() => parseM072Args(["--scenario", "x"])).toThrow("unsupported argument");
    expect(() => parseM072Args(["--expect-status", "m072_unknown" as M072StatusCode])).toThrow("--expect-status must be one of");
  });

  test("uses the checked-in package script as package-wiring success evidence", () => {
    const report = evaluateM072VerifierContract({ generatedAt: "2026-05-10T00:00:00.000Z" });

    expect(report.packageWiring).toEqual({
      scriptName: "verify:m072",
      expected: "bun scripts/verify-m072.ts",
      present: true,
      matches: true,
    });
    expect(check(report, "M072-PACKAGE-WIRING")).toMatchObject({ passed: true, status: "pass" });
  });

  test("emits stable safe JSON report shape for source-evidence closure", () => {
    const report = evaluateM072VerifierContract({
      generatedAt: "2026-05-10T00:00:00.000Z",
      ...makeReaders(),
    });

    expect(report.command).toBe("verify:m072");
    expect(report.generated_at).toBe("2026-05-10T00:00:00.000Z");
    expect(report.proofMode).toBe("repo-source-candidate-publication-bridge");
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m072_candidate_publication_bridge_ok");
    expect(report.failing_check_id).toBeNull();
    expect(report.check_ids).toEqual([
      "M072-BRIDGE-CONTRACT-SOURCE",
      "M072-INLINE-MCP-SOURCE",
      "M072-REVIEW-HANDLER-SOURCE",
      "M072-REVIEW-DETAILS-SAFE-FORMATTING",
      "M072-DEFERRED-OWNER-CONTINUITY",
      "M072-PACKAGE-WIRING",
      "M072-REPORT-SAFETY",
    ]);
    expect(report.packageWiring).toEqual({
      scriptName: "verify:m072",
      expected: "bun scripts/verify-m072.ts",
      present: true,
      matches: true,
    });
    expect(report.deferred_owner_continuity).toMatchObject({
      row_id: "candidate-finding-mcp-publication-bridge",
      expected_milestone: "M072",
      expected_slice: "S01",
      actual_milestone: "M072",
      actual_slice: "S01",
      status: "pass",
    });
    expect(report.source_evidence.map((entry) => [entry.path, entry.status])).toEqual([
      ["src/issue-131/candidate-publication-bridge.ts", "present"],
      ["src/issue-131/review-handler-publication-bridge.ts", "present"],
      ["src/issue-131/deferred-handoff.ts", "present"],
      ["src/execution/mcp/review-output-publication-gate.ts", "present"],
      ["src/execution/mcp/inline-review-server.ts", "present"],
      ["src/handlers/review.ts", "present"],
      ["src/lib/review-utils.ts", "present"],
      ["package.json", "present"],
    ]);
    expect(report.report_safety).toEqual({
      safe: true,
      forbidden_field_count: 0,
      canary_leak_count: 0,
      redaction_flags: {
        source_text_included: false,
        raw_candidate_payload_included: false,
        github_comment_body_included: false,
        planning_artifact_path_included: false,
      },
    });
    expectNoCanaryLeak(report);
  });

  test("fails closed for missing bridge source without throwing", () => {
    const report = evaluateM072VerifierContract({
      ...makeReaders({ "src/issue-131/candidate-publication-bridge.ts": undefined as unknown as string }),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M072-BRIDGE-CONTRACT-SOURCE");
    expect(check(report, "M072-BRIDGE-CONTRACT-SOURCE").issueCategories).toContain("missing_source");
    expect(report.source_evidence.find((entry) => entry.path === "src/issue-131/candidate-publication-bridge.ts")?.status).toBe("missing");
  });

  test("fails closed for planning-only source text and does not leak planning paths", () => {
    const report = evaluateM072VerifierContract({
      ...makeReaders({
        "src/issue-131/candidate-publication-bridge.ts": "Task Plan says CANDIDATE_PUBLICATION_BRIDGE_VERSION is done in .gsd/milestones/M072/PLAN.md",
      }),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M072-BRIDGE-CONTRACT-SOURCE");
    expect(check(report, "M072-BRIDGE-CONTRACT-SOURCE").issueCategories).toContain("planning_only_evidence");
    expect(JSON.stringify(report)).not.toContain(".gsd/milestones/M072/PLAN.md");
  });

  test("fails closed for absent inline MCP bridge markers", () => {
    const report = evaluateM072VerifierContract({
      ...makeReaders({ "src/execution/mcp/inline-review-server.ts": "function create_inline_comment() { return true; }" }),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M072-INLINE-MCP-SOURCE");
    expect(check(report, "M072-INLINE-MCP-SOURCE").issueCategories).toContain("missing_marker");
  });

  test("fails closed for absent review-handler markers", () => {
    const report = evaluateM072VerifierContract({
      ...makeReaders({ "src/handlers/review.ts": "formatReviewDetailsSummary({});" }),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M072-REVIEW-HANDLER-SOURCE");
    expect(check(report, "M072-REVIEW-HANDLER-SOURCE").issueCategories).toContain("missing_marker");
  });

  test("fails closed for unsafe report field probes without echoing raw canaries", () => {
    const report = evaluateM072VerifierContract({
      ...makeReaders(),
      reportSafetyProbe: {
        rawPrompt: "prompt canary",
        rawDiff: "diff --git a/private b/private",
        modelOutput: "model output canary",
        fingerprint: "fingerprint canary",
        privateKey: "BEGIN PRIVATE KEY",
        commentBody: "github comment body",
        rawCandidateBody: "raw candidate body",
      },
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M072-REPORT-SAFETY");
    expect(report.report_safety.safe).toBe(false);
    expect(report.report_safety.forbidden_field_count).toBeGreaterThan(0);
    expect(report.report_safety.canary_leak_count).toBeGreaterThan(0);
    expectNoCanaryLeak(report);
  });

  test("fails closed for malformed handoff rows with bounded diagnostics", () => {
    const rows = mutableHandoffRows().filter((row) => row.rowId !== "candidate-finding-mcp-publication-bridge");
    const report = evaluateM072VerifierContract({
      ...makeReaders(),
      handoffRows: rows,
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M072-DEFERRED-OWNER-CONTINUITY");
    expect(report.deferred_owner_continuity.status).toBe("fail");
    expect(report.deferred_owner_continuity.diagnostics.join("\n")).toContain("row is missing");
    expect(JSON.stringify(report.deferred_owner_continuity).length).toBeLessThan(900);
  });

  test("fails closed for M072/S01 owner drift", () => {
    const rows = mutableHandoffRows();
    const index = rows.findIndex((row) => row.rowId === "candidate-finding-mcp-publication-bridge");
    rows[index] = { ...rows[index]!, owner: { milestone: "M073", slice: "S02" } };
    const report = evaluateM072VerifierContract({
      ...makeReaders(),
      handoffRows: rows,
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M072-DEFERRED-OWNER-CONTINUITY");
    expect(report.deferred_owner_continuity).toMatchObject({ actual_milestone: "M073", actual_slice: "S02", status: "fail" });
    expect(check(report, "M072-DEFERRED-OWNER-CONTINUITY").issueCategories).toContain("owner_drift");
  });

  test("prioritizes missing package script over other source failures", () => {
    const report = evaluateM072VerifierContract({
      ...makeReaders({
        packageJson: PACKAGE_WITHOUT_M072,
        "src/issue-131/candidate-publication-bridge.ts": undefined as unknown as string,
      }),
    });

    expect(report.success).toBe(false);
    expect(report.packageWiring).toEqual({ scriptName: "verify:m072", expected: "bun scripts/verify-m072.ts", present: false, matches: false });
    expect(report.failing_check_id).toBe("M072-PACKAGE-WIRING");
    expect(check(report, "M072-PACKAGE-WIRING").issueCategories).toContain("package_wiring");
  });

  test("reports malformed package JSON and mismatched package wiring as absent or mismatched", () => {
    const malformed = evaluateM072VerifierContract({ ...makeReaders({ packageJson: "{" }) });
    expect(malformed.success).toBe(false);
    expect(malformed.packageWiring).toEqual({ scriptName: "verify:m072", expected: "bun scripts/verify-m072.ts", present: false, matches: false });
    expect(malformed.failing_check_id).toBe("M072-PACKAGE-WIRING");

    const weak = evaluateM072VerifierContract({ ...makeReaders({ packageJson: PACKAGE_WEAK_M072 }) });
    expect(weak.success).toBe(false);
    expect(weak.packageWiring).toEqual({ scriptName: "verify:m072", expected: "bun scripts/verify-m072.ts", present: true, matches: false });
    expect(weak.failing_check_id).toBe("M072-PACKAGE-WIRING");
  });

  test("main emits human and JSON output, supports expected status, and returns invalid-arg status", async () => {
    const human = await runMain([]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("verify:m072 m072_candidate_publication_bridge_ok success=true");
    expect(human.stdout).toContain("package: wired");
    expect(() => JSON.parse(human.stdout)).toThrow();
    expect(human.stderr).toBe("");

    const ok = await runMain(["--json"]);
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(ok.stdout).status_code).toBe("m072_candidate_publication_bridge_ok");
    expect(ok.stderr).toBe("");

    const expectedFail = await runMain(["--json", "--expect-status", "m072_candidate_publication_bridge_failed"], PACKAGE_WITHOUT_M072);
    expect(expectedFail.exitCode).toBe(0);
    expect(JSON.parse(expectedFail.stdout).failing_check_id).toBe("M072-PACKAGE-WIRING");
    expect(expectedFail.stderr).toBe("");

    const expectedMismatch = await runMain(["--json", "--expect-status", "m072_candidate_publication_bridge_ok"], PACKAGE_WITHOUT_M072);
    expect(expectedMismatch.exitCode).toBe(1);
    expect(JSON.parse(expectedMismatch.stdout).status_code).toBe("m072_candidate_publication_bridge_failed");
    expect(expectedMismatch.stderr).toContain("expected status m072_candidate_publication_bridge_ok but got m072_candidate_publication_bridge_failed");

    const invalidExpectedStatus = await runMain(["--expect-status", "m072_unknown"]);
    expect(invalidExpectedStatus.exitCode).toBe(2);
    expect(JSON.parse(invalidExpectedStatus.stdout).status_code).toBe("m072_invalid_arg");
    expect(invalidExpectedStatus.stderr).toContain("--expect-status must be one of");

    const invalid = await runMain(["--bad-arg"]);
    expect(invalid.exitCode).toBe(2);
    expect(JSON.parse(invalid.stdout).status_code).toBe("m072_invalid_arg");
    expect(invalid.stderr).toContain("unsupported argument");
    expect(invalid.stderr.length).toBeLessThan(260);
  });
});
