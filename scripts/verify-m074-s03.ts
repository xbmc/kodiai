import { createInlineReviewPublisher, type InlineReviewPublicationResult } from "../src/execution/mcp/inline-review-publisher.ts";
import { buildPrDiffCommentabilityIndex } from "../src/execution/formatter-suggestions.ts";
import {
  reduceSamePrFixEligibility,
  type SamePrFixCandidateInput,
  type SamePrFixEligibilityReasonCode,
} from "../src/review-lifecycle/same-pr-fix-eligibility.ts";
import { buildCandidateReviewOutputKey } from "../src/review-orchestration/review-candidate-publication-adapter.ts";

export const COMMAND_NAME = "verify:m074:s03" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m074-s03.ts" as const;

export type M074S03Check = {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type M074S03Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: "m074_s03_ok" | "m074_s03_contract_failed" | "m074_s03_invalid_arg";
  readonly eligibleCount: number;
  readonly blockedCount: number;
  readonly cappedCount: number;
  readonly reasonCoverage: Partial<Record<SamePrFixEligibilityReasonCode | "already-published", number>>;
  readonly redaction: {
    readonly privateOnly: true;
    readonly rawPromptsIncluded: false;
    readonly rawModelOutputIncluded: false;
    readonly candidateBodiesIncluded: false;
    readonly toolPayloadsIncluded: false;
    readonly diffsIncluded: false;
    readonly unboundedDiffsIncluded: false;
    readonly secretDetected: boolean;
    readonly canariesAbsent: boolean;
  };
  readonly samePrPublicationShape: {
    readonly owner: string;
    readonly repo: string;
    readonly pullNumber: number;
    readonly commitSha: string;
    readonly path: string;
    readonly line: number;
    readonly side: "RIGHT";
    readonly suggestionBlockPresent: boolean;
    readonly markerPresent: boolean;
  };
  readonly idempotency: {
    readonly firstStatus: InlineReviewPublicationResult["status"];
    readonly replayStatus: InlineReviewPublicationResult["status"];
    readonly replayReason?: InlineReviewPublicationResult["reason"];
    readonly createReviewCommentCalls: number;
  };
  readonly commentability: {
    readonly status: InlineReviewPublicationResult["status"];
    readonly reason?: InlineReviewPublicationResult["reason"];
  };
  readonly boundedPublicSummary: boolean;
  readonly checks: readonly M074S03Check[];
  readonly issues: readonly string[];
};

export type M074S03Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type M074S03EvaluationOptions = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly mutatePublishedBody?: (body: string) => string;
  readonly mutateReportForCanaryCheck?: (report: Omit<M074S03Report, "success" | "statusCode" | "checks" | "issues">) => Omit<M074S03Report, "success" | "statusCode" | "checks" | "issues">;
};

const HELP_TEXT = `Usage: bun scripts/verify-m074-s03.ts [--json] [--help]\n\nVerifies M074/S03 same-PR fix eligibility, suggestion publication, reason-code coverage, idempotency, commentability, and redaction with in-memory fixtures.\n`;

const CORRELATION = {
  owner: "acme",
  repo: "widgets",
  pullNumber: 74,
  reviewOutputKey: "m074-s03-review-output",
  deliveryId: "delivery-m074-s03",
  commitSha: "abc123def456",
} as const;

const PR_DIFF = [
  "diff --git a/src/eligible.ts b/src/eligible.ts",
  "--- a/src/eligible.ts",
  "+++ b/src/eligible.ts",
  "@@ -10,1 +10,1 @@",
  "+eligible line",
  "diff --git a/src/duplicate.ts b/src/duplicate.ts",
  "--- a/src/duplicate.ts",
  "+++ b/src/duplicate.ts",
  "@@ -20,1 +20,1 @@",
  "+duplicate line",
  "diff --git a/src/cap.ts b/src/cap.ts",
  "--- a/src/cap.ts",
  "+++ b/src/cap.ts",
  "@@ -30,1 +30,1 @@",
  "+cap line",
  "diff --git a/src/secret.ts b/src/secret.ts",
  "--- a/src/secret.ts",
  "+++ b/src/secret.ts",
  "@@ -40,1 +40,1 @@",
  "+secret line",
  "diff --git a/src/reducer.ts b/src/reducer.ts",
  "--- a/src/reducer.ts",
  "+++ b/src/reducer.ts",
  "@@ -50,1 +50,1 @@",
  "+reducer line",
  "diff --git a/src/candidate.ts b/src/candidate.ts",
  "--- a/src/candidate.ts",
  "+++ b/src/candidate.ts",
  "@@ -60,1 +60,1 @@",
  "+candidate line",
  "diff --git a/src/formatter.ts b/src/formatter.ts",
  "--- a/src/formatter.ts",
  "+++ b/src/formatter.ts",
  "@@ -70,1 +70,1 @@",
  "+formatter line",
  "diff --git a/src/commentable.ts b/src/commentable.ts",
  "--- a/src/commentable.ts",
  "+++ b/src/commentable.ts",
  "@@ -90,1 +90,1 @@",
  "+commentable line",
].join("\n");

const NON_COMMENTABLE_DIFF = [
  "diff --git a/src/commentable.ts b/src/commentable.ts",
  "--- a/src/commentable.ts",
  "+++ b/src/commentable.ts",
  "@@ -1,1 +1,1 @@",
  "+different line",
].join("\n");

const FORBIDDEN_CANARIES = [
  "RAW_PROMPT_CANARY",
  "RAW_MODEL_OUTPUT_CANARY",
  "CANDIDATE_BODY_CANARY",
  "TOOL_PAYLOAD_CANARY",
  "SECRET_TOKEN_CANARY",
  "sk-supersecret12345",
  "UNBOUNDED_DIFF_CANARY",
  "diff --git a/private",
  "PRIVATE_REPLACEMENT_CANARY",
] as const;

const REQUIRED_REASONS: ReadonlyArray<SamePrFixEligibilityReasonCode | "already-published"> = [
  "eligible",
  "unmappable-location",
  "duplicate-fix",
  "max-fixes-exceeded",
  "secret-detected",
  "reducer-denied",
  "candidate-denied",
  "formatter-owned",
  "line-not-commentable",
  "already-published",
];

function candidate(overrides: Partial<SamePrFixCandidateInput> = {}): SamePrFixCandidateInput {
  return {
    filePath: "src/eligible.ts",
    startLine: 10,
    endLine: 10,
    title: "Use the safe replacement",
    severity: "major",
    category: "correctness",
    replacementText: "const value = computeSafely();",
    candidateApproved: true,
    reducerApproved: true,
    findingIdentity: "eligible-finding",
    rawPrompt: "RAW_PROMPT_CANARY hidden prompt",
    rawModelOutput: "RAW_MODEL_OUTPUT_CANARY hidden model output",
    rawCandidateBody: "CANDIDATE_BODY_CANARY hidden candidate body",
    rawToolPayload: { private: "TOOL_PAYLOAD_CANARY" },
    rawDiffText: "UNBOUNDED_DIFF_CANARY diff --git a/private b/private",
    ...overrides,
  };
}

export function parseM074S03Args(args: readonly string[]): M074S03Args {
  let json = false;
  let help = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  return { json, help };
}

export async function evaluateM074S03Contract(options: M074S03EvaluationOptions = {}): Promise<M074S03Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const packageJsonText = await readPackageJsonText();
  const duplicateSeed = candidate({ filePath: "src/duplicate.ts", startLine: 20, endLine: 20, findingIdentity: "duplicate", replacementText: "const duplicate = true;" });
  const duplicateIdentity = reduceSamePrFixEligibility({
    reviewOutputKey: CORRELATION.reviewOutputKey,
    deliveryId: CORRELATION.deliveryId,
    prDiffText: PR_DIFF,
    maxSuggestions: 10,
    candidates: [duplicateSeed],
  }).drafts[0]?.identity;

  const eligibility = reduceSamePrFixEligibility({
    reviewOutputKey: CORRELATION.reviewOutputKey,
    deliveryId: CORRELATION.deliveryId,
    prDiffText: PR_DIFF,
    formatterOwnedRanges: [{ path: "src/formatter.ts", startLine: 70, endLine: 70 }],
    maxSuggestions: 1,
    seenIdentities: duplicateIdentity ? [duplicateIdentity] : [],
    candidates: [
      candidate({ findingIdentity: "eligible" }),
      candidate({ filePath: "../outside.ts", startLine: 12, endLine: 12, findingIdentity: "unmappable", replacementText: "PRIVATE_REPLACEMENT_CANARY unmappable" }),
      duplicateSeed,
      candidate({ filePath: "src/cap.ts", startLine: 30, endLine: 30, findingIdentity: "cap", replacementText: "PRIVATE_REPLACEMENT_CANARY capped" }),
      candidate({ filePath: "src/secret.ts", startLine: 40, endLine: 40, findingIdentity: "secret", replacementText: "const token = 'ghp_123456789012345678901234567890123456';" }),
      candidate({ filePath: "src/reducer.ts", startLine: 50, endLine: 50, findingIdentity: "reducer", reducerApproved: false, replacementText: "PRIVATE_REPLACEMENT_CANARY reducer" }),
      candidate({ filePath: "src/candidate.ts", startLine: 60, endLine: 60, findingIdentity: "candidate", candidateApproved: false, replacementText: "PRIVATE_REPLACEMENT_CANARY candidate" }),
      candidate({ filePath: "src/formatter.ts", startLine: 70, endLine: 70, findingIdentity: "formatter", replacementText: "PRIVATE_REPLACEMENT_CANARY formatter" }),
      candidate({ filePath: "src/commentable.ts", startLine: 91, endLine: 91, findingIdentity: "line", replacementText: "PRIVATE_REPLACEMENT_CANARY line" }),
    ],
  });

  const draft = eligibility.drafts[0];
  if (!draft) throw new Error("fixture_setup_failed: expected an eligible draft");
  const candidateReviewOutputKey = buildCandidateReviewOutputKey(CORRELATION.reviewOutputKey, draft.identity);
  const publication = await exercisePublisher({
    reviewOutputKey: candidateReviewOutputKey,
    location: { path: draft.path, line: draft.line, side: draft.side },
    body: options.mutatePublishedBody?.(draft.body) ?? draft.body,
  });
  const nonCommentable = await exerciseNonCommentablePublisher({
    reviewOutputKey: buildCandidateReviewOutputKey(CORRELATION.reviewOutputKey, "non-commentable"),
    body: draft.body,
  });

  const reasonCoverage: Partial<Record<SamePrFixEligibilityReasonCode | "already-published", number>> = {
    ...eligibility.summary.reasonCounts,
    "already-published": publication.replay.reason === "already-published" ? 1 : 0,
  };

  const baseReport = {
    command: COMMAND_NAME,
    generatedAt,
    eligibleCount: eligibility.summary.counts.eligible,
    blockedCount: eligibility.summary.counts.blocked,
    cappedCount: eligibility.summary.counts.capped,
    reasonCoverage,
    redaction: {
      ...eligibility.summary.redaction,
      canariesAbsent: true,
    },
    samePrPublicationShape: publication.shape,
    idempotency: {
      firstStatus: publication.first.status,
      replayStatus: publication.replay.status,
      ...(publication.replay.reason ? { replayReason: publication.replay.reason } : {}),
      createReviewCommentCalls: publication.createReviewCommentCalls,
    },
    commentability: {
      status: nonCommentable.status,
      ...(nonCommentable.reason ? { reason: nonCommentable.reason } : {}),
    },
    boundedPublicSummary: isBoundedEligibilitySummary(eligibility.summary),
  } satisfies Omit<M074S03Report, "success" | "statusCode" | "checks" | "issues">;
  const reportForChecks = options.mutateReportForCanaryCheck?.(baseReport) ?? baseReport;
  const reportJson = JSON.stringify(reportForChecks);
  const canariesAbsent = FORBIDDEN_CANARIES.every((canary) => !reportJson.includes(canary));
  const packageWiringPresent = hasExpectedPackageScript(packageJsonText);

  const checks: M074S03Check[] = [
    {
      id: "reason-code-coverage",
      passed: REQUIRED_REASONS.every((reason) => (reportForChecks.reasonCoverage[reason] ?? 0) > 0),
      detail: `reasons=${REQUIRED_REASONS.filter((reason) => (reportForChecks.reasonCoverage[reason] ?? 0) > 0).join(",")}`,
    },
    {
      id: "bounded-counts",
      passed: reportForChecks.eligibleCount === 1 && reportForChecks.blockedCount === 7 && reportForChecks.cappedCount === 1 && reportForChecks.boundedPublicSummary,
      detail: `eligible=${reportForChecks.eligibleCount} blocked=${reportForChecks.blockedCount} capped=${reportForChecks.cappedCount} bounded=${reportForChecks.boundedPublicSummary}`,
    },
    {
      id: "redaction-flags-and-canaries",
      passed: reportForChecks.redaction.privateOnly === true
        && reportForChecks.redaction.rawPromptsIncluded === false
        && reportForChecks.redaction.rawModelOutputIncluded === false
        && reportForChecks.redaction.candidateBodiesIncluded === false
        && reportForChecks.redaction.toolPayloadsIncluded === false
        && reportForChecks.redaction.diffsIncluded === false
        && reportForChecks.redaction.unboundedDiffsIncluded === false
        && reportForChecks.redaction.secretDetected === true
        && canariesAbsent,
      detail: `redaction=${canariesAbsent ? "pass" : "fail"}`,
    },
    {
      id: "same-pr-suggestion-shape",
      passed: reportForChecks.samePrPublicationShape.owner === CORRELATION.owner
        && reportForChecks.samePrPublicationShape.repo === CORRELATION.repo
        && reportForChecks.samePrPublicationShape.pullNumber === CORRELATION.pullNumber
        && reportForChecks.samePrPublicationShape.commitSha === CORRELATION.commitSha
        && reportForChecks.samePrPublicationShape.side === "RIGHT"
        && reportForChecks.samePrPublicationShape.suggestionBlockPresent
        && reportForChecks.samePrPublicationShape.markerPresent,
      detail: `target=${reportForChecks.samePrPublicationShape.owner}/${reportForChecks.samePrPublicationShape.repo}#${reportForChecks.samePrPublicationShape.pullNumber} marker=${reportForChecks.samePrPublicationShape.markerPresent}`,
    },
    {
      id: "idempotency-already-published",
      passed: reportForChecks.idempotency.firstStatus === "published"
        && reportForChecks.idempotency.replayStatus === "skipped"
        && reportForChecks.idempotency.replayReason === "already-published"
        && reportForChecks.idempotency.createReviewCommentCalls === 1,
      detail: `first=${reportForChecks.idempotency.firstStatus} replay=${reportForChecks.idempotency.replayStatus}:${reportForChecks.idempotency.replayReason} calls=${reportForChecks.idempotency.createReviewCommentCalls}`,
    },
    {
      id: "commentability-negative",
      passed: reportForChecks.commentability.status === "failed" && reportForChecks.commentability.reason === "line-not-commentable-in-pr-diff",
      detail: `status=${reportForChecks.commentability.status} reason=${reportForChecks.commentability.reason}`,
    },
    {
      id: "package-wiring",
      passed: packageWiringPresent,
      detail: `expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`,
    },
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`);

  return {
    ...reportForChecks,
    redaction: { ...reportForChecks.redaction, canariesAbsent },
    success: issues.length === 0,
    statusCode: issues.length === 0 ? "m074_s03_ok" : "m074_s03_contract_failed",
    checks,
    issues,
  };
}

type PublishCall = {
  owner: string;
  repo: string;
  pull_number: number;
  body: string;
  path: string;
  line: number;
  side: "RIGHT";
  commit_id: string;
};

async function exercisePublisher(input: { reviewOutputKey: string; location: { path: string; line: number; side: "RIGHT" }; body: string }) {
  const calls: PublishCall[] = [];
  const octokit = {
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha: CORRELATION.commitSha } } }),
        createReviewComment: async (params: PublishCall) => {
          calls.push(params);
          return {
            data: {
              id: 7400 + calls.length,
              html_url: `https://example.test/${CORRELATION.owner}/${CORRELATION.repo}/pull/${CORRELATION.pullNumber}#discussion_r${7400 + calls.length}`,
              path: params.path,
              line: params.line,
              original_line: params.line,
            },
          };
        },
      },
    },
  };
  const publisher = (shouldPublish: boolean) => createInlineReviewPublisher({
    getOctokit: async () => octokit as never,
    owner: CORRELATION.owner,
    repo: CORRELATION.repo,
    prNumber: CORRELATION.pullNumber,
    botHandles: ["kodiai"],
    reviewOutputKey: input.reviewOutputKey,
    deliveryId: CORRELATION.deliveryId,
    publicationGate: { resolve: async () => ({ shouldPublish }) as never },
    prDiffCommentabilityIndex: buildPrDiffCommentabilityIndex(PR_DIFF),
  });
  const first = await publisher(true).publish({ location: input.location, body: input.body });
  const replay = await publisher(false).publish({ location: input.location, body: input.body });
  const call = calls[0];
  return {
    first,
    replay,
    createReviewCommentCalls: calls.length,
    shape: {
      owner: call?.owner ?? "",
      repo: call?.repo ?? "",
      pullNumber: call?.pull_number ?? 0,
      commitSha: call?.commit_id ?? "",
      path: call?.path ?? "",
      line: call?.line ?? 0,
      side: call?.side ?? "RIGHT",
      suggestionBlockPresent: typeof call?.body === "string" && call.body.includes("```suggestion\n") && call.body.includes("\n```"),
      markerPresent: typeof call?.body === "string" && call.body.includes(`<!-- kodiai:review-output-key:${input.reviewOutputKey} -->`),
    },
  };
}

async function exerciseNonCommentablePublisher(input: { reviewOutputKey: string; body: string }): Promise<InlineReviewPublicationResult> {
  const publisher = createInlineReviewPublisher({
    getOctokit: async () => ({}) as never,
    owner: CORRELATION.owner,
    repo: CORRELATION.repo,
    prNumber: CORRELATION.pullNumber,
    botHandles: [],
    reviewOutputKey: input.reviewOutputKey,
    deliveryId: CORRELATION.deliveryId,
    publicationGate: { resolve: async () => ({ shouldPublish: true }) as never },
    prDiffCommentabilityIndex: buildPrDiffCommentabilityIndex(NON_COMMENTABLE_DIFF),
  });
  return publisher.publish({ location: { path: "src/commentable.ts", line: 90, side: "RIGHT" }, body: input.body });
}

function isBoundedEligibilitySummary(summary: ReturnType<typeof reduceSamePrFixEligibility>["summary"]): boolean {
  return summary.schema === "same-pr-fix-eligibility.v1"
    && Object.keys(summary.reasonCounts).length <= 10
    && Object.keys(summary.omittedReasonCounts).length <= 10
    && typeof summary.reviewOutputKey === "string"
    && typeof summary.deliveryId === "string";
}

function hasExpectedPackageScript(packageJsonText: string): boolean {
  try {
    const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> };
    return parsed.scripts?.[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT;
  } catch {
    return packageJsonText.includes(`"${COMMAND_NAME}": "${EXPECTED_PACKAGE_SCRIPT}"`)
      || packageJsonText.includes(`"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"`);
  }
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  let parsed: M074S03Args;
  try {
    parsed = parseM074S03Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    process.stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m074_s03_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const report = await evaluateM074S03Contract();
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write([
      `${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`,
      `eligible=${report.eligibleCount} blocked=${report.blockedCount} capped=${report.cappedCount}`,
      `reasonCoverage=${JSON.stringify(report.reasonCoverage)}`,
      `redaction=${report.redaction.canariesAbsent ? "pass" : "fail"}`,
      `samePr=${report.samePrPublicationShape.owner}/${report.samePrPublicationShape.repo}#${report.samePrPublicationShape.pullNumber} suggestion=${report.samePrPublicationShape.suggestionBlockPresent ? "pass" : "fail"}`,
      `idempotency=${report.idempotency.firstStatus}->${report.idempotency.replayStatus}:${report.idempotency.replayReason ?? "none"} calls=${report.idempotency.createReviewCommentCalls}`,
      `commentability=${report.commentability.status}:${report.commentability.reason ?? "none"}`,
      ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []),
      "",
    ].join("\n"));
  }
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
