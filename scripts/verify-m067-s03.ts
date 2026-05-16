import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";
import {
  createDegradedReviewReducerResult,
  reduceReviewFindings,
  type ProcessedReviewFinding,
  type ReviewReducerCounts,
  type ReviewReducerResult,
} from "../src/review-orchestration/review-reducer.ts";
import type { GraphValidationFinding, GraphValidationResult } from "../src/review-graph/validation.ts";
import type { ReviewGraphBlastRadiusResult } from "../src/review-graph/query.ts";

export const M067_S03_CHECK_IDS = [
  "REDUCER-COUNTS",
  "REDUCER-BEHAVIOR-PARITY",
  "REDUCER-DETAILS-COMPACT",
  "REDUCER-DEGRADED-FAIL-OPEN",
  "GRAPH-VALIDATION-CONSUMED",
] as const;

export type M067S03CheckId = (typeof M067_S03_CHECK_IDS)[number];

export type M067S03StatusCode =
  | "m067_s03_ok"
  | "m067_s03_contract_failed"
  | "m067_s03_invalid_arg";

export type M067S03CheckStatusCode =
  | "reducer_counts_ok"
  | "reducer_counts_invalid"
  | "reducer_behavior_parity_ok"
  | "reducer_behavior_parity_failed"
  | "reducer_details_compact"
  | "reducer_details_not_compact"
  | "reducer_degraded_fail_open"
  | "reducer_degraded_failed_closed"
  | "graph_validation_consumed"
  | "graph_validation_not_consumed";

export type M067S03Check = {
  id: M067S03CheckId;
  passed: boolean;
  status_code: M067S03CheckStatusCode;
  detail: string;
};

export type M067S03ReducerEvidence = {
  status: "ready" | "degraded";
  counts: ReviewReducerCounts;
  visible_comment_ids: number[];
  filtered_inline_comment_ids: number[];
  suppressed_comment_ids: number[];
  rewritten_comment_ids: number[];
  deprioritized_comment_ids: number[];
  low_confidence_comment_ids: number[];
  audit_sources: string[];
  details_line: string;
  review_details_line_count: number;
};

export type M067S03DegradedEvidence = {
  status: "ready" | "degraded";
  reason: string | undefined;
  visible_count: number;
  filtered_inline_count: number;
  details_line: string;
};

export type M067S03GraphValidationEvidence = {
  enabled: boolean;
  validated: number;
  uncertain: number;
  verdicts: string[];
};

export type M067S03Report = {
  command: "verify:m067:s03";
  generated_at: string;
  success: boolean;
  status_code: M067S03StatusCode;
  check_ids: M067S03CheckId[];
  checks: M067S03Check[];
  failing_check_id: M067S03CheckId | null;
  issues: string[];
  reducer: M067S03ReducerEvidence;
  degraded: M067S03DegradedEvidence;
  graph_validation: M067S03GraphValidationEvidence;
};

type EvaluateM067S03Params = {
  generatedAt?: string;
  overrides?: {
    reducerFn?: typeof reduceReviewFindings;
    degradedReason?: string;
  };
};

type VerifyM067S03Args = {
  help: boolean;
  json: boolean;
};

const RAW_LEAK_MARKERS = [
  "PROMPT_SECRET",
  "diff --git",
  "TOKEN=",
  "abc123",
  "rawPrompt",
  "rawDiff",
  "secretToken",
  "Unsafe raw fixture title",
  "external API always fails",
  "persisted state before validating",
];

function representativeFindings(): ProcessedReviewFinding[] {
  return [
    {
      commentId: 1,
      filePath: "src/direct.ts",
      title: "Validate user input before saving",
      severity: "major",
      category: "correctness",
      startLine: 10,
      endLine: 12,
      suppressed: false,
      confidence: 90,
    },
    {
      commentId: 2,
      filePath: "src/indirect.ts",
      title: "The code mutates persisted state before validating. Some external API always fails in v1.2.3.",
      severity: "major",
      category: "correctness",
      startLine: 20,
      endLine: 21,
      suppressed: false,
      confidence: 90,
      claimClassification: {
        summaryLabel: "mixed",
        claims: [
          {
            text: "The code mutates persisted state before validating the request payload and can save invalid user input to storage",
            label: "diff-grounded",
            confidence: 0.95,
          },
          {
            text: "Some external API always fails in v1.2.3",
            label: "external-knowledge",
            evidence: "version-specific claim",
            confidence: 0.9,
          },
        ],
      },
    },
    {
      commentId: 3,
      filePath: "src/suppressed.ts",
      title: "Suppress this legacy issue",
      severity: "medium",
      category: "correctness",
      startLine: 30,
      endLine: 31,
      suppressed: false,
      confidence: 80,
    },
    {
      commentId: 4,
      filePath: "docs/readme.md",
      title: "Minor documentation nit",
      severity: "minor",
      category: "documentation",
      startLine: 1,
      endLine: 1,
      suppressed: false,
      confidence: 90,
    },
  ];
}

function graphBlastRadiusFixture(): ReviewGraphBlastRadiusResult {
  return {
    changedFiles: ["src/direct.ts"],
    seedSymbols: [],
    impactedFiles: [
      {
        path: "src/indirect.ts",
        score: 0.92,
        confidence: 0.87,
        reasons: ["imports changed module"],
        relatedChangedPaths: ["src/direct.ts"],
        languages: ["typescript"],
      },
    ],
    probableDependents: [],
    likelyTests: [],
    graphStats: {
      files: 2,
      nodes: 2,
      edges: 1,
      changedFilesFound: 1,
    },
  };
}

function testLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
  };
}

async function validateGraphFixture<T extends GraphValidationFinding>(
  findings: T[],
): Promise<GraphValidationResult<T>> {
  const validatedFindings = findings.map((finding) => {
    const isIndirect = finding.filePath === "src/indirect.ts";
    return {
      ...finding,
      graphValidated: isIndirect,
      graphValidationVerdict: isIndirect ? "uncertain" as const : "skipped" as const,
    };
  });

  return {
    succeeded: true,
    validatedCount: 1,
    confirmedCount: 0,
    uncertainCount: 1,
    findings: validatedFindings,
  };
}

async function buildReducerResult(reducerFn: typeof reduceReviewFindings): Promise<ReviewReducerResult> {
  return reducerFn({
    findings: representativeFindings(),
    workspaceDir: ".",
    filesByCategory: {},
    filesByLanguage: {},
    languageRules: undefined,
    reviewSuppressions: ["legacy issue"],
    minConfidence: 50,
    prioritizationWeights: { severity: 1, fileRisk: 0, category: 0, recurrence: 0 },
    feedbackSuppression: { suppressedFingerprints: new Set(), suppressedPatternCount: 0, patterns: [] },
    priorFindingContext: null,
    diffContent: "",
    prBody: null,
    commitMessages: [],
    tieredFiles: { isLargePR: false, abbreviated: [] },
    graphBlastRadius: graphBlastRadiusFixture(),
    graphValidationEnabled: true,
    riskScores: [],
    resolvedMaxComments: 50,
    logger: testLogger(),
    baseLog: { repo: "owner/repo", prNumber: 1 },
    repo: "owner/repo",
    clusterModelStore: null,
    embeddingProvider: null,
    guardrailAuditStore: undefined,
    graphValidationLLM: null,
    validateGraphAmplifiedFindings: validateGraphFixture,
  });
}

function countReviewReducerLines(value: string): number {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("Review reducer:")).length;
}

function renderReviewDetailsWithReducer(result: ReviewReducerResult): string {
  return formatReviewDetailsSummary({
    reviewOutputKey: "m067-s03-review-reducer",
    filesReviewed: 4,
    linesAdded: 120,
    linesRemoved: 45,
    findingCounts: {
      critical: 0,
      major: 2,
      medium: 1,
      minor: 1,
    },
    profileSelection: {
      selectedProfile: "balanced",
      source: "auto",
      autoBand: null,
      linesChanged: 165,
    },
    contributorExperience: projectContributorExperienceContract({
      source: "author-cache",
      tier: "regular",
    }).reviewDetails,
    reviewReducer: result.detailsSummary,
    completedAt: "2026-05-09T17:00:00.000Z",
  });
}

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/abc123/gi, "redacted")
    .replace(/rawPrompt/gi, "raw-prompt-redacted")
    .replace(/rawDiff/gi, "raw-diff-redacted")
    .replace(/secretToken/gi, "secret-token-redacted")
    .replace(/Unsafe raw fixture title/gi, "unsafe-title-redacted")
    .replace(/external API always fails/gi, "external-claim-redacted")
    .replace(/persisted state before validating/gi, "grounded-claim-redacted");
}

function hasRawLeak(value: string): boolean {
  return RAW_LEAK_MARKERS.some((marker) => value.includes(marker));
}

function toReducerEvidence(result: ReviewReducerResult, reviewDetails: string): M067S03ReducerEvidence {
  return {
    status: result.status,
    counts: result.counts,
    visible_comment_ids: result.visibleFindings.map((finding) => finding.commentId).sort((a, b) => a - b),
    filtered_inline_comment_ids: result.filteredInlineFindings.map((finding) => finding.commentId).sort((a, b) => a - b),
    suppressed_comment_ids: result.findings
      .filter((finding) => finding.suppressed === true)
      .map((finding) => finding.commentId)
      .sort((a, b) => a - b),
    rewritten_comment_ids: result.findings
      .filter((finding) => finding.filterAction === "rewritten" || finding.filterAction === "guardrail-rewritten")
      .map((finding) => finding.commentId)
      .sort((a, b) => a - b),
    deprioritized_comment_ids: result.findings
      .filter((finding) => finding.deprioritized === true)
      .map((finding) => finding.commentId)
      .sort((a, b) => a - b),
    low_confidence_comment_ids: result.lowConfidenceFindings.map((finding) => finding.commentId).sort((a, b) => a - b),
    audit_sources: result.audit.map((event) => event.source).sort(),
    details_line: sanitizeEvidenceText(result.detailsSummary.text),
    review_details_line_count: countReviewReducerLines(reviewDetails),
  };
}

function toGraphValidationEvidence(result: ReviewReducerResult): M067S03GraphValidationEvidence {
  return {
    enabled: true,
    validated: result.counts.graphValidated,
    uncertain: result.counts.graphUncertain,
    verdicts: result.findings
      .map((finding) => String(finding.graphValidationVerdict ?? "skipped"))
      .sort(),
  };
}

function buildCountsCheck(evidence: M067S03ReducerEvidence): M067S03Check {
  const failures = [
    ...(evidence.status !== "ready" ? [`reducer status was ${evidence.status}`] : []),
    ...(evidence.counts.input !== 4 ? [`input count was ${evidence.counts.input}`] : []),
    ...(evidence.counts.kept !== 2 ? [`kept count was ${evidence.counts.kept}`] : []),
    ...(evidence.counts.suppressed !== 1 ? [`suppressed count was ${evidence.counts.suppressed}`] : []),
    ...(evidence.counts.rewritten !== 1 ? [`rewritten count was ${evidence.counts.rewritten}`] : []),
    ...(evidence.counts.deprioritized !== 0 ? [`deprioritized count was ${evidence.counts.deprioritized}`] : []),
    ...(evidence.counts.lowConfidence !== 1 ? [`low-confidence count was ${evidence.counts.lowConfidence}`] : []),
    ...(evidence.counts.graphValidated !== 1 ? [`graph-validated count was ${evidence.counts.graphValidated}`] : []),
    ...(evidence.counts.graphUncertain !== 1 ? [`graph-uncertain count was ${evidence.counts.graphUncertain}`] : []),
  ];

  return {
    id: "REDUCER-COUNTS",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "reducer_counts_ok" : "reducer_counts_invalid",
    detail: failures.length === 0
      ? "reducer exposes bounded kept/suppressed/rewritten/deprioritized/low-confidence/audit/graph counts"
      : failures.join("; "),
  };
}

function buildBehaviorParityCheck(evidence: M067S03ReducerEvidence): M067S03Check {
  const failures = [
    ...(evidence.visible_comment_ids.join(",") !== "1,2" ? [`visible ids were ${evidence.visible_comment_ids.join(",") || "none"}`] : []),
    ...(evidence.filtered_inline_comment_ids.join(",") !== "3,4" ? [`filtered inline ids were ${evidence.filtered_inline_comment_ids.join(",") || "none"}`] : []),
    ...(evidence.suppressed_comment_ids.join(",") !== "3" ? [`suppressed ids were ${evidence.suppressed_comment_ids.join(",") || "none"}`] : []),
    ...(evidence.rewritten_comment_ids.join(",") !== "2" ? [`rewritten ids were ${evidence.rewritten_comment_ids.join(",") || "none"}`] : []),
    ...(evidence.low_confidence_comment_ids.join(",") !== "4" ? [`low-confidence ids were ${evidence.low_confidence_comment_ids.join(",") || "none"}`] : []),
    ...(evidence.deprioritized_comment_ids.length !== 0 ? [`unexpected deprioritized ids ${evidence.deprioritized_comment_ids.join(",")}`] : []),
  ];

  return {
    id: "REDUCER-BEHAVIOR-PARITY",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "reducer_behavior_parity_ok" : "reducer_behavior_parity_failed",
    detail: failures.length === 0
      ? "reducer preserves inline gate behavior: kept visible findings, rewritten mixed claim, suppressed known pattern, and low-confidence cleanup candidate"
      : failures.join("; "),
  };
}

function buildDetailsCompactCheck(evidence: M067S03ReducerEvidence): M067S03Check {
  const line = evidence.details_line;
  const failures = [
    ...(evidence.review_details_line_count !== 1 ? [`Review Details emitted ${evidence.review_details_line_count} reducer lines`] : []),
    ...(!line.startsWith("Review reducer: ready") ? ["reducer details line did not use ready prefix"] : []),
    ...(line.length > 240 ? [`reducer details line too long (${line.length} chars)`] : []),
    ...(!line.includes("kept=2") ? ["details line omitted kept=2"] : []),
    ...(!line.includes("suppressed=1") ? ["details line omitted suppressed=1"] : []),
    ...(!line.includes("rewritten=1") ? ["details line omitted rewritten=1"] : []),
    ...(!line.includes("graphValidated=1") ? ["details line omitted graphValidated=1"] : []),
    ...(hasRawLeak(line) ? ["details line leaked raw finding, diff, prompt, or secret-like data"] : []),
  ];

  return {
    id: "REDUCER-DETAILS-COMPACT",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "reducer_details_compact" : "reducer_details_not_compact",
    detail: failures.length === 0
      ? "Review Details contains exactly one bounded Review reducer line with no raw fixture leakage"
      : failures.join("; "),
  };
}

function buildDegradedFailOpenCheck(evidence: M067S03DegradedEvidence): M067S03Check {
  const line = evidence.details_line;
  const failures = [
    ...(evidence.status !== "degraded" ? [`degraded status was ${evidence.status}`] : []),
    ...(evidence.visible_count !== 4 ? [`visible count was ${evidence.visible_count}`] : []),
    ...(evidence.filtered_inline_count !== 0 ? [`filtered inline count was ${evidence.filtered_inline_count}`] : []),
    ...(!line.includes("Review reducer: degraded") ? ["degraded line missing degraded status"] : []),
    ...(!line.includes("kept=4") ? ["degraded line missing kept=4"] : []),
    ...(hasRawLeak(line) || hasRawLeak(evidence.reason ?? "") ? ["degraded evidence leaked raw reason data"] : []),
  ];

  return {
    id: "REDUCER-DEGRADED-FAIL-OPEN",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "reducer_degraded_fail_open" : "reducer_degraded_failed_closed",
    detail: failures.length === 0
      ? "degraded reducer result preserves visible findings and skips destructive filtered-inline cleanup"
      : failures.join("; "),
  };
}

function buildGraphValidationConsumedCheck(evidence: M067S03GraphValidationEvidence): M067S03Check {
  const failures = [
    ...(evidence.enabled !== true ? ["graph validation was not enabled in fixture"] : []),
    ...(evidence.validated !== 1 ? [`validated count was ${evidence.validated}`] : []),
    ...(evidence.uncertain !== 1 ? [`uncertain count was ${evidence.uncertain}`] : []),
    ...(evidence.verdicts.join(",") !== "skipped,skipped,skipped,uncertain" ? [`verdicts were ${evidence.verdicts.join(",")}`] : []),
  ];

  return {
    id: "GRAPH-VALIDATION-CONSUMED",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "graph_validation_consumed" : "graph_validation_not_consumed",
    detail: failures.length === 0
      ? "typed graph-validation state is consumed as metadata-only reducer counts without suppressing uncertain findings"
      : failures.join("; "),
  };
}

function deriveOutcome(checks: M067S03Check[]): Pick<M067S03Report, "success" | "status_code" | "failing_check_id" | "issues"> {
  const failingCheck = checks.find((check) => !check.passed);
  if (!failingCheck) {
    return {
      success: true,
      status_code: "m067_s03_ok",
      failing_check_id: null,
      issues: [],
    };
  }

  return {
    success: false,
    status_code: "m067_s03_contract_failed",
    failing_check_id: failingCheck.id,
    issues: [`${failingCheck.id}: ${failingCheck.detail}`],
  };
}

function emptyCounts(): ReviewReducerCounts {
  return {
    input: 0,
    kept: 0,
    suppressed: 0,
    rewritten: 0,
    deprioritized: 0,
    lowConfidence: 0,
    auditEvents: 0,
    severityDemoted: 0,
    graphValidated: 0,
    graphUncertain: 0,
  };
}

function emptyReducerEvidence(): M067S03ReducerEvidence {
  return {
    status: "degraded",
    counts: emptyCounts(),
    visible_comment_ids: [],
    filtered_inline_comment_ids: [],
    suppressed_comment_ids: [],
    rewritten_comment_ids: [],
    deprioritized_comment_ids: [],
    low_confidence_comment_ids: [],
    audit_sources: [],
    details_line: "",
    review_details_line_count: 0,
  };
}

function buildInvalidArgReport(params: { generatedAt?: string; issue: string }): M067S03Report {
  return {
    command: "verify:m067:s03",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: false,
    status_code: "m067_s03_invalid_arg",
    check_ids: [...M067_S03_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    issues: [sanitizeEvidenceText(params.issue)],
    reducer: emptyReducerEvidence(),
    degraded: {
      status: "degraded",
      reason: "invalid-arg",
      visible_count: 0,
      filtered_inline_count: 0,
      details_line: "",
    },
    graph_validation: {
      enabled: true,
      validated: 0,
      uncertain: 0,
      verdicts: [],
    },
  };
}

export async function evaluateM067S03ReviewReducerContract(params?: EvaluateM067S03Params): Promise<M067S03Report> {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const reducerFn = params?.overrides?.reducerFn ?? reduceReviewFindings;
  const reducerResult = await buildReducerResult(reducerFn);
  const reducerReviewDetails = renderReviewDetailsWithReducer(reducerResult);
  const reducerEvidence = toReducerEvidence(reducerResult, reducerReviewDetails);
  const degradedResult = createDegradedReviewReducerResult({
    findings: representativeFindings(),
    reason: params?.overrides?.degradedReason ?? "reducer-exception",
  });
  const degradedEvidence: M067S03DegradedEvidence = {
    status: degradedResult.status,
    reason: sanitizeEvidenceText(degradedResult.reason ?? "unknown"),
    visible_count: degradedResult.visibleFindings.length,
    filtered_inline_count: degradedResult.filteredInlineFindings.length,
    details_line: sanitizeEvidenceText(degradedResult.detailsSummary.text),
  };
  const graphValidation = toGraphValidationEvidence(reducerResult);
  const checks = [
    buildCountsCheck(reducerEvidence),
    buildBehaviorParityCheck(reducerEvidence),
    buildDetailsCompactCheck(reducerEvidence),
    buildDegradedFailOpenCheck(degradedEvidence),
    buildGraphValidationConsumedCheck(graphValidation),
  ];
  const outcome = deriveOutcome(checks);

  return {
    command: "verify:m067:s03",
    generated_at: generatedAt,
    success: outcome.success,
    status_code: outcome.status_code,
    check_ids: [...M067_S03_CHECK_IDS],
    checks,
    failing_check_id: outcome.failing_check_id,
    issues: outcome.issues,
    reducer: reducerEvidence,
    degraded: degradedEvidence,
    graph_validation: graphValidation,
  };
}

export function parseVerifyM067S03Args(args: string[]): VerifyM067S03Args {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m067:s03 -- [--json]",
    "",
    "Verifies the M067 S03 review-reducer contract using local inline fixtures only.",
    "",
    "Options:",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM067S03Report(report: M067S03Report): string {
  const lines = [
    "# M067 S03 — Review Reducer Contract Verifier",
    "",
    `Status: ${report.status_code}`,
    `Overall success: ${String(report.success)}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Reducer: status=${report.reducer.status} input=${report.reducer.counts.input} kept=${report.reducer.counts.kept} suppressed=${report.reducer.counts.suppressed} rewritten=${report.reducer.counts.rewritten} lowConfidence=${report.reducer.counts.lowConfidence}`,
    `Graph validation: validated=${report.graph_validation.validated} uncertain=${report.graph_validation.uncertain}`,
    `Degraded fail-open: visible=${report.degraded.visible_count} filteredInline=${report.degraded.filtered_inline_count} reason=${report.degraded.reason ?? "none"}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.status_code} (passed=${String(check.passed)})`);
    lines.push(`  - ${sanitizeEvidenceText(check.detail)}`);
  }

  lines.push("", "Reducer details:");
  lines.push(`- ${sanitizeEvidenceText(report.reducer.details_line)}`);
  lines.push(`- ${sanitizeEvidenceText(report.degraded.details_line)}`);

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${sanitizeEvidenceText(issue)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluateFn?: typeof evaluateM067S03ReviewReducerContract;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const evaluateFn = deps?.evaluateFn ?? evaluateM067S03ReviewReducerContract;

  try {
    const options = parseVerifyM067S03Args(args);

    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const report = await evaluateFn();
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM067S03Report(report));

    if (!report.success) {
      stderr.write(`verify:m067:s03 failed: ${report.failing_check_id ?? report.status_code}\n`);
    }

    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = buildInvalidArgReport({ issue: message });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
