import { readFileSync } from "node:fs";

import {
  ISSUE_131_DEFERRED_HANDOFF_ROWS,
  type Issue131DeferredHandoffRow,
} from "../src/issue-131/deferred-handoff.ts";

export const COMMAND_NAME = "verify:m072" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m072.ts" as const;

export const M072_STATUS_CODES = [
  "m072_candidate_publication_bridge_ok",
  "m072_candidate_publication_bridge_failed",
  "m072_invalid_arg",
] as const;

export type M072StatusCode = typeof M072_STATUS_CODES[number];

export const M072_SOURCE_PATHS = [
  "src/issue-131/candidate-publication-bridge.ts",
  "src/issue-131/review-handler-publication-bridge.ts",
  "src/issue-131/deferred-handoff.ts",
  "src/execution/mcp/review-output-publication-gate.ts",
  "src/execution/mcp/inline-review-server.ts",
  "src/handlers/review.ts",
  "src/lib/review-utils.ts",
  "package.json",
] as const;

export type M072SourcePath = typeof M072_SOURCE_PATHS[number];

export const M072_CHECK_IDS = [
  "M072-BRIDGE-CONTRACT-SOURCE",
  "M072-INLINE-MCP-SOURCE",
  "M072-REVIEW-HANDLER-SOURCE",
  "M072-REVIEW-DETAILS-SAFE-FORMATTING",
  "M072-DEFERRED-OWNER-CONTINUITY",
  "M072-PACKAGE-WIRING",
  "M072-REPORT-SAFETY",
] as const;

export type M072CheckId = typeof M072_CHECK_IDS[number];
export type M072IssueCategory =
  | "missing_source"
  | "planning_only_evidence"
  | "missing_marker"
  | "unsafe_report_shape"
  | "owner_drift"
  | "package_wiring";

export type M072Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly expectStatus: M072StatusCode | null;
};

export type M072PackageWiring = {
  readonly scriptName: typeof COMMAND_NAME;
  readonly expected: typeof EXPECTED_PACKAGE_SCRIPT;
  readonly present: boolean;
  readonly matches: boolean;
};

export type M072SourceEvidenceState = {
  readonly path: M072SourcePath;
  readonly status: "present" | "missing" | "planning_only" | "marker_missing";
  readonly marker_count: number;
  readonly required_marker_count: number;
};

export type M072VerifierCheck = {
  readonly id: M072CheckId;
  readonly passed: boolean;
  readonly status: "pass" | "fail";
  readonly status_code: M072StatusCode;
  readonly issueCategories: readonly M072IssueCategory[];
  readonly detail: string;
};

export type M072DeferredOwnerContinuity = {
  readonly row_id: "candidate-finding-mcp-publication-bridge";
  readonly expected_milestone: "M072";
  readonly expected_slice: "S01";
  readonly actual_milestone: string;
  readonly actual_slice: string;
  readonly status: "pass" | "fail";
  readonly diagnostics: readonly string[];
};

export type M072ReportSafety = {
  readonly safe: boolean;
  readonly forbidden_field_count: number;
  readonly canary_leak_count: number;
  readonly redaction_flags: {
    readonly source_text_included: false;
    readonly raw_candidate_payload_included: false;
    readonly github_comment_body_included: false;
    readonly planning_artifact_path_included: false;
  };
};

export type M072VerifierReport = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "repo-source-candidate-publication-bridge";
  readonly success: boolean;
  readonly status_code: M072StatusCode;
  readonly check_ids: readonly M072CheckId[];
  readonly checks: readonly M072VerifierCheck[];
  readonly failing_check_id: M072CheckId | null;
  readonly source_evidence: readonly M072SourceEvidenceState[];
  readonly packageWiring: M072PackageWiring;
  readonly deferred_owner_continuity: M072DeferredOwnerContinuity;
  readonly report_safety: M072ReportSafety;
  readonly issue_categories: readonly M072IssueCategory[];
  readonly issues: readonly string[];
};

export type M072MainDeps = {
  readonly stdout?: { write(chunk: string): void };
  readonly stderr?: { write(chunk: string): void };
  readonly generatedAt?: string;
  readonly readFileText?: (path: M072SourcePath) => string | undefined;
  readonly readPackageJsonText?: () => string | undefined;
  readonly handoffRows?: readonly Issue131DeferredHandoffRow[];
  readonly reportSafetyProbe?: unknown;
  readonly evaluate?: typeof evaluateM072VerifierContract;
};

type SourceRequirement = {
  readonly path: M072SourcePath;
  readonly markers: readonly string[];
};

const SOURCE_REQUIREMENTS = {
  bridgeContract: {
    path: "src/issue-131/candidate-publication-bridge.ts",
    markers: [
      "CANDIDATE_PUBLICATION_BRIDGE_VERSION",
      "createCandidatePublicationBridgeRecord",
      "projectCandidatePublicationReducerHandoffInput",
      "githubCommentBodyIncluded: false",
      "reducerHandoffIncludesRawPayload: false",
      "row.owner.milestone === \"M072\"",
      "row.owner.slice === \"S01\"",
    ],
  },
  inlineMcp: {
    path: "src/execution/mcp/review-output-publication-gate.ts",
    markers: [
      "createCandidatePublicationBridgeRecord",
      "projectCandidatePublicationReducerHandoffInput",
      "getCandidatePublicationBridgeCaptureState",
      "evaluateInlineCandidatePublication",
      "sourceLabel: \"inline-mcp-review-comment\"",
    ],
  },
  inlineServer: {
    path: "src/execution/mcp/inline-review-server.ts",
    markers: [
      "m072-candidate-publication-bridge",
      "evaluateBridgePublicationEvidence",
      "hasUnsafeBridgeRedactionFlags",
      "reducerHandoffIncludesRawPayload",
      "Candidate verification or M072 bridge evidence denied inline review publication",
    ],
  },
  reviewHandlerBridge: {
    path: "src/issue-131/review-handler-publication-bridge.ts",
    markers: [
      "REVIEW_HANDLER_PUBLICATION_BRIDGE_SOURCE_LABEL",
      "projectReviewHandlerCandidatePublicationBridgeEvidence",
      "ReviewHandlerPublicationBridgeReviewDetails",
      "candidatePublicationBridgePrivateOnly: true",
      "githubCommentBodyIncluded: false",
      "reducerHandoffIncludesRawPayload: false",
    ],
  },
  reviewHandlerIntegration: {
    path: "src/handlers/review.ts",
    markers: [
      "projectReviewHandlerCandidatePublicationBridgeEvidence",
      "m072-review-handler-publication-bridge",
      "Captured M072 review-handler candidate publication bridge before public publication",
      "candidatePublicationBridge: handlerCandidatePublicationBridge.reviewDetails",
      "formatReviewDetailsSummary",
    ],
  },
  reviewDetailsFormatting: {
    path: "src/lib/review-utils.ts",
    markers: [
      "formatCandidatePublicationBridgeLine",
      "- M072 candidate publication bridge:",
      "hasUnsafeBridgeRedaction",
      "githubCommentBodyIncluded !== false",
      "reducerHandoffIncludesRawPayload !== false",
      "Keep Review Details fail-open; malformed M072 bridge projections must not block publication",
    ],
  },
  deferredHandoff: {
    path: "src/issue-131/deferred-handoff.ts",
    markers: [
      "candidate-finding-mcp-publication-bridge",
      "owner: { milestone: \"M072\", slice: \"S01\" }",
      "M072/S01 candidate-publication bridge owner",
      "findForbiddenDeferredHandoffFields",
      "validateIssue131DeferredHandoffRows",
    ],
  },
} as const satisfies Record<string, SourceRequirement>;

const FORBIDDEN_REPORT_FIELD_NAMES = new Set([
  "prompt",
  "rawPrompt",
  "modelPrompt",
  "modelOutput",
  "rawModelOutput",
  "fingerprint",
  "rawFingerprint",
  "privateKey",
  "commentBody",
  "rawCommentBody",
  "body",
  "candidateBody",
  "rawCandidateBody",
  "diff",
  "rawDiff",
]);

const CANARY_PATTERNS = [
  /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/,
  /raw-secret-canary/i,
  /raw candidate body/i,
  /github comment body/i,
  /model output canary/i,
  /prompt canary/i,
  /diff --git /,
  /fingerprint canary/i,
  /(?:^|[\s`'"])(?:\.gsd|\.planning|\.audits)\//,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeLine(writer: { write(chunk: string): void } | undefined, chunk: string): void {
  writer?.write(chunk);
}

function boundedIssue(message: string): string {
  if (message.startsWith("invalid_cli_args:")) return message.slice(0, 240);
  if (message.includes("package.json")) return message.slice(0, 240);
  return "m072 verifier dependency failed.";
}

export function parseM072Args(argv: readonly string[]): M072Args {
  let json = false;
  let help = false;
  let expectStatus: M072StatusCode | null = null;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--expect-status") {
      const value = argv[index + 1];
      if (!M072_STATUS_CODES.includes(value as M072StatusCode)) {
        throw new Error(`invalid_cli_args: --expect-status must be one of ${M072_STATUS_CODES.join(",")}`);
      }
      expectStatus = value as M072StatusCode;
      index++;
    } else {
      throw new Error(`invalid_cli_args: unsupported argument ${arg}`);
    }
  }

  return { json, help, expectStatus };
}

function readSourceFile(path: M072SourcePath): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function parsePackageWiring(packageJsonText: string | undefined): M072PackageWiring {
  if (typeof packageJsonText !== "string") {
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false };
  }
  try {
    const parsed = JSON.parse(packageJsonText) as unknown;
    const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
    const script = scripts[COMMAND_NAME];
    return {
      scriptName: COMMAND_NAME,
      expected: EXPECTED_PACKAGE_SCRIPT,
      present: typeof script === "string",
      matches: script === EXPECTED_PACKAGE_SCRIPT,
    };
  } catch {
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false };
  }
}

function isPlanningOnlyEvidence(text: string): boolean {
  const mentionsPlanningPath = /(?:^|[\s`'"])(?:\.gsd|\.planning|\.audits)\//.test(text);
  const mentionsPlanLanguage = /(?:Slice Plan|Task Plan|Done when|Expected Output|planning prose)/i.test(text);
  return mentionsPlanningPath || mentionsPlanLanguage;
}

function sourceEvidenceFor(requirement: SourceRequirement, text: string | undefined): M072SourceEvidenceState {
  if (typeof text !== "string") {
    return { path: requirement.path, status: "missing", marker_count: 0, required_marker_count: requirement.markers.length };
  }
  const markerCount = requirement.markers.filter((marker) => text.includes(marker)).length;
  if (isPlanningOnlyEvidence(text)) {
    return { path: requirement.path, status: "planning_only", marker_count: markerCount, required_marker_count: requirement.markers.length };
  }
  return {
    path: requirement.path,
    status: markerCount === requirement.markers.length ? "present" : "marker_missing",
    marker_count: markerCount,
    required_marker_count: requirement.markers.length,
  };
}

function makeCheck(id: M072CheckId, passed: boolean, detail: string, categories: readonly M072IssueCategory[] = []): M072VerifierCheck {
  return {
    id,
    passed,
    status: passed ? "pass" : "fail",
    status_code: passed ? "m072_candidate_publication_bridge_ok" : "m072_candidate_publication_bridge_failed",
    issueCategories: categories,
    detail,
  };
}

function categoriesForStates(states: readonly M072SourceEvidenceState[]): M072IssueCategory[] {
  const categories = new Set<M072IssueCategory>();
  for (const state of states) {
    if (state.status === "missing") categories.add("missing_source");
    if (state.status === "planning_only") categories.add("planning_only_evidence");
    if (state.status === "marker_missing") categories.add("missing_marker");
  }
  return [...categories].sort();
}

function sourceCheck(id: M072CheckId, states: readonly M072SourceEvidenceState[], passDetail: string): M072VerifierCheck {
  const failed = states.filter((state) => state.status !== "present");
  if (failed.length === 0) return makeCheck(id, true, passDetail);
  return makeCheck(
    id,
    false,
    `${failed.length} source evidence path(s) failed: ${failed.map((state) => `${state.path}:${state.status}`).join(", ")}.`,
    categoriesForStates(failed),
  );
}

function validateOwnerContinuity(rows: readonly Issue131DeferredHandoffRow[]): M072DeferredOwnerContinuity {
  const row = rows.find((entry) => entry.rowId === "candidate-finding-mcp-publication-bridge");
  const diagnostics: string[] = [];
  const actualMilestone = row?.owner?.milestone ?? "missing";
  const actualSlice = row?.owner?.slice ?? "missing";

  if (!row) diagnostics.push("candidate-finding-mcp-publication-bridge: row is missing.");
  if (row && (!Array.isArray(row.requirementRefs) || !row.requirementRefs.includes("R130"))) {
    diagnostics.push("candidate-finding-mcp-publication-bridge: R130 ownership ref is missing.");
  }
  if (actualMilestone !== "M072" || actualSlice !== "S01") {
    diagnostics.push(`candidate-finding-mcp-publication-bridge: expected M072/S01 owner, found ${String(actualMilestone).slice(0, 24)}/${String(actualSlice).slice(0, 24)}.`);
  }
  if (row && (!row.consumerOwnerLabel?.trim() || !row.proofRequiredBeforePromotion?.trim() || !row.reason?.trim())) {
    diagnostics.push("candidate-finding-mcp-publication-bridge: compact handoff text is malformed.");
  }

  return {
    row_id: "candidate-finding-mcp-publication-bridge",
    expected_milestone: "M072",
    expected_slice: "S01",
    actual_milestone: String(actualMilestone).slice(0, 24),
    actual_slice: String(actualSlice).slice(0, 24),
    status: diagnostics.length === 0 ? "pass" : "fail",
    diagnostics: diagnostics.slice(0, 6),
  };
}

function visitForbiddenFields(value: unknown, findings: string[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) visitForbiddenFields(child, findings);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_REPORT_FIELD_NAMES.has(key)) findings.push(key);
    visitForbiddenFields(child, findings);
  }
}

function countCanaryLeaks(jsonText: string): number {
  return CANARY_PATTERNS.reduce((count, pattern) => count + (pattern.test(jsonText) ? 1 : 0), 0);
}

function reportSafety(probe: unknown): M072ReportSafety {
  const findings: string[] = [];
  visitForbiddenFields(probe, findings);
  const probeText = JSON.stringify(probe ?? {}) ?? "";
  const canaryLeakCount = countCanaryLeaks(probeText);
  return {
    safe: findings.length === 0 && canaryLeakCount === 0,
    forbidden_field_count: findings.length,
    canary_leak_count: canaryLeakCount,
    redaction_flags: {
      source_text_included: false,
      raw_candidate_payload_included: false,
      github_comment_body_included: false,
      planning_artifact_path_included: false,
    },
  };
}

function issueCategories(checks: readonly M072VerifierCheck[]): M072IssueCategory[] {
  return [...new Set(checks.flatMap((check) => check.issueCategories))].sort();
}

function firstFailingCheck(checks: readonly M072VerifierCheck[], packageWiring: M072PackageWiring): M072VerifierCheck | null {
  if (!packageWiring.matches) {
    return checks.find((check) => check.id === "M072-PACKAGE-WIRING" && !check.passed) ?? checks.find((check) => !check.passed) ?? null;
  }
  return checks.find((check) => !check.passed) ?? null;
}

export function evaluateM072VerifierContract(options: {
  readonly generatedAt?: string;
  readonly readFileText?: (path: M072SourcePath) => string | undefined;
  readonly readPackageJsonText?: () => string | undefined;
  readonly handoffRows?: readonly Issue131DeferredHandoffRow[];
  readonly reportSafetyProbe?: unknown;
} = {}): M072VerifierReport {
  const readFileText = options.readFileText ?? readSourceFile;
  let packageJsonText: string | undefined;
  try {
    packageJsonText = (options.readPackageJsonText ?? (() => readFileSync("package.json", "utf8")))();
  } catch {
    packageJsonText = undefined;
  }

  const evidence = {
    bridgeContract: sourceEvidenceFor(SOURCE_REQUIREMENTS.bridgeContract, readFileText(SOURCE_REQUIREMENTS.bridgeContract.path)),
    inlineMcp: sourceEvidenceFor(SOURCE_REQUIREMENTS.inlineMcp, readFileText(SOURCE_REQUIREMENTS.inlineMcp.path)),
    inlineServer: sourceEvidenceFor(SOURCE_REQUIREMENTS.inlineServer, readFileText(SOURCE_REQUIREMENTS.inlineServer.path)),
    reviewHandlerBridge: sourceEvidenceFor(SOURCE_REQUIREMENTS.reviewHandlerBridge, readFileText(SOURCE_REQUIREMENTS.reviewHandlerBridge.path)),
    reviewHandlerIntegration: sourceEvidenceFor(SOURCE_REQUIREMENTS.reviewHandlerIntegration, readFileText(SOURCE_REQUIREMENTS.reviewHandlerIntegration.path)),
    reviewDetailsFormatting: sourceEvidenceFor(SOURCE_REQUIREMENTS.reviewDetailsFormatting, readFileText(SOURCE_REQUIREMENTS.reviewDetailsFormatting.path)),
    deferredHandoff: sourceEvidenceFor(SOURCE_REQUIREMENTS.deferredHandoff, readFileText(SOURCE_REQUIREMENTS.deferredHandoff.path)),
  };

  const packageWiring = parsePackageWiring(packageJsonText);
  const ownerContinuity = validateOwnerContinuity(options.handoffRows ?? ISSUE_131_DEFERRED_HANDOFF_ROWS);
  const safety = reportSafety(options.reportSafetyProbe);

  const checks: M072VerifierCheck[] = [
    sourceCheck("M072-BRIDGE-CONTRACT-SOURCE", [evidence.bridgeContract, evidence.deferredHandoff], "Candidate bridge contract and M072/S01 handoff owner source are present."),
    sourceCheck("M072-INLINE-MCP-SOURCE", [evidence.inlineMcp, evidence.inlineServer], "Inline MCP publication gate consumes candidate bridge evidence."),
    sourceCheck("M072-REVIEW-HANDLER-SOURCE", [evidence.reviewHandlerBridge, evidence.reviewHandlerIntegration], "Review handler captures private bridge evidence before public publication."),
    sourceCheck("M072-REVIEW-DETAILS-SAFE-FORMATTING", [evidence.reviewDetailsFormatting], "Review Details formatting emits bounded M072 bridge diagnostics with fail-open safety."),
    makeCheck(
      "M072-DEFERRED-OWNER-CONTINUITY",
      ownerContinuity.status === "pass",
      ownerContinuity.status === "pass" ? "Deferred handoff owner remains M072/S01." : ownerContinuity.diagnostics.join(" "),
      ownerContinuity.status === "pass" ? [] : ["owner_drift"],
    ),
    makeCheck(
      "M072-PACKAGE-WIRING",
      packageWiring.matches,
      packageWiring.matches ? `package.json scripts.${COMMAND_NAME} is wired.` : `package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`,
      packageWiring.matches ? [] : ["package_wiring"],
    ),
    makeCheck(
      "M072-REPORT-SAFETY",
      safety.safe,
      safety.safe ? "Report contains only bounded diagnostics and redaction flags." : "Report safety probe detected forbidden raw payload fields or canary values.",
      safety.safe ? [] : ["unsafe_report_shape"],
    ),
  ];

  const failingCheck = firstFailingCheck(checks, packageWiring);
  const success = failingCheck === null;
  const statusCode: M072StatusCode = success ? "m072_candidate_publication_bridge_ok" : "m072_candidate_publication_bridge_failed";
  const sourceEvidence = [
    evidence.bridgeContract,
    evidence.reviewHandlerBridge,
    evidence.deferredHandoff,
    evidence.inlineMcp,
    evidence.inlineServer,
    evidence.reviewHandlerIntegration,
    evidence.reviewDetailsFormatting,
    {
      path: "package.json" as const,
      status: packageWiring.present ? (packageWiring.matches ? "present" as const : "marker_missing" as const) : "missing" as const,
      marker_count: packageWiring.matches ? 1 : 0,
      required_marker_count: 1,
    },
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`);

  return {
    command: COMMAND_NAME,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    proofMode: "repo-source-candidate-publication-bridge",
    success,
    status_code: statusCode,
    check_ids: M072_CHECK_IDS,
    checks: checks.map((check) => ({ ...check, status_code: check.passed ? statusCode : "m072_candidate_publication_bridge_failed" })),
    failing_check_id: failingCheck?.id ?? null,
    source_evidence: sourceEvidence,
    packageWiring,
    deferred_owner_continuity: ownerContinuity,
    report_safety: safety,
    issue_categories: issueCategories(checks),
    issues,
  };
}

function helpText(): string {
  return `Usage: bun run verify:m072 [--json] [--expect-status ${M072_STATUS_CODES.join("|")}]

Builds bounded repo-source evidence for the M072 candidate-publication bridge, Review Details safe formatting, package wiring, and M072/S01 deferred handoff continuity. The verifier never reads planning artifacts and never emits raw candidate payloads.
`;
}

function renderHuman(report: M072VerifierReport): string {
  return [
    `${COMMAND_NAME} ${report.status_code} success=${report.success}`,
    `failing_check_id: ${report.failing_check_id ?? "none"}`,
    `package: ${report.packageWiring.matches ? "wired" : "unwired"}`,
    `owner: ${report.deferred_owner_continuity.actual_milestone}/${report.deferred_owner_continuity.actual_slice} (${report.deferred_owner_continuity.status})`,
    `report_safety: ${report.report_safety.safe ? "safe" : "unsafe"}`,
    "checks:",
    ...report.checks.map((check) => `- ${check.id}: ${check.status}`),
    ...(report.issues.length > 0 ? ["issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

function buildInvalidArgReport(issue: string): M072VerifierReport {
  const detail = boundedIssue(issue);
  const check: M072VerifierCheck = {
    id: "M072-BRIDGE-CONTRACT-SOURCE",
    passed: false,
    status: "fail",
    status_code: "m072_invalid_arg",
    issueCategories: ["missing_marker"],
    detail: "CLI argument parsing failed.",
  };
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    proofMode: "repo-source-candidate-publication-bridge",
    success: false,
    status_code: "m072_invalid_arg",
    check_ids: M072_CHECK_IDS,
    checks: [check],
    failing_check_id: check.id,
    source_evidence: [],
    packageWiring: { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false },
    deferred_owner_continuity: {
      row_id: "candidate-finding-mcp-publication-bridge",
      expected_milestone: "M072",
      expected_slice: "S01",
      actual_milestone: "missing",
      actual_slice: "missing",
      status: "fail",
      diagnostics: ["not evaluated because CLI argument parsing failed."],
    },
    report_safety: {
      safe: true,
      forbidden_field_count: 0,
      canary_leak_count: 0,
      redaction_flags: {
        source_text_included: false,
        raw_candidate_payload_included: false,
        github_comment_body_included: false,
        planning_artifact_path_included: false,
      },
    },
    issue_categories: ["missing_marker"],
    issues: [detail],
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2), deps: M072MainDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: M072Args;
  try {
    args = parseM072Args(argv);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : String(error));
    writeLine(stdout, `${JSON.stringify(report, null, 2)}\n`);
    writeLine(stderr, `${report.issues[0]}\n`);
    return 2;
  }

  if (args.help) {
    writeLine(stdout, helpText());
    return 0;
  }

  const evaluate = deps.evaluate ?? evaluateM072VerifierContract;
  const report = evaluate({
    generatedAt: deps.generatedAt,
    readFileText: deps.readFileText,
    readPackageJsonText: deps.readPackageJsonText,
    handoffRows: deps.handoffRows,
    reportSafetyProbe: deps.reportSafetyProbe,
  });

  if (args.json) {
    writeLine(stdout, `${JSON.stringify(report, null, 2)}\n`);
  } else {
    writeLine(stdout, renderHuman(report));
  }

  const expectedStatusMatched = args.expectStatus !== null && report.status_code === args.expectStatus;
  if (!report.success && !expectedStatusMatched) {
    writeLine(stderr, `${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  }
  if (args.expectStatus !== null) {
    if (!expectedStatusMatched) {
      writeLine(stderr, `${COMMAND_NAME} expected status ${args.expectStatus} but got ${report.status_code}\n`);
    }
    return expectedStatusMatched ? 0 : 1;
  }
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
